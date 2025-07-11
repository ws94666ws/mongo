/**
 * This is a regression test for SERVER-73641, and runs queries against both sharded and
 * unsharded collections, with relevant data both on and off the DB primary shard, and shows that
 * we correctly *don't* generate _id predicates when there may be extended range data.
 *
 * @tags: [
 *   # This test moves chunks around itself.
 *   assumes_balancer_off,
 *   requires_fcv_80,
 * ]
 */

import {getTimeseriesCollForDDLOps} from "jstests/core/timeseries/libs/viewless_timeseries_util.js";
import {getQueryPlanner} from "jstests/libs/query/analyze_plan.js";
import {ShardingTest} from "jstests/libs/shardingtest.js";

const dbName = 'test';
const collName = 'myColl';
const fullCollName = `${dbName}.${collName}`;
const timeFieldName = 'time';

// Check the 'parsedQuery' field from explain output which will contain the predicates generated by
// the DocumentSourceUnpackBucketInternal::doOptimizeAt(). This is easier than checking the actual
// stages, which may very depending on what the optimizer decides.
//
// The parameter 'expectedParsedQueryPreds' is an object that maps the shard name to an array of
// predicates expected for that shard. If a value is an array, that indicates boolean expressions
// that are ANDed together. Values that are objects represent a single expression.
function checkExplain(coll, pipeline, expectedParsedQueryPreds) {
    const explain = coll.explain().aggregate(pipeline);
    const explainShards = explain.shards;
    assert.eq(Object.keys(explainShards).length, Object.keys(expectedParsedQueryPreds).length);
    for (let shard in explainShards) {
        const expectedPreds = expectedParsedQueryPreds[shard];
        assert.neq(null, expectedPreds);
        // Get the parsed query in an optimizer-agnostic way
        const parsedQuery = getQueryPlanner(explainShards[shard]).parsedQuery;
        if (parsedQuery["$and"]) {
            // Expected query predicates should be an array of expressions that are ANDed together
            const actualPreds = parsedQuery["$and"];
            assert.sameMembers(expectedPreds, actualPreds);
        } else {
            // Expected query predicate is a single expression e.g., {$alwaysFalse: 1}
            assert.docEq(expectedPreds, parsedQuery);
        }
    }
}

function runTimeSeriesExtendedRangeTest(st, testCase) {
    'use strict';

    jsTestLog(`Running: ${testCase.name}`);

    const {
        createCollectionFn,
        docsToInsert,
        moveChunksFn,
        matchPredicate,
        parsedQueryPreds,
        expected
    } = testCase;

    const db = st.getDB(dbName);
    var coll = db.getCollection(collName);
    coll.drop();
    coll = createCollectionFn(db);

    assert.commandWorked(coll.insert(docsToInsert));
    if (moveChunksFn) {
        moveChunksFn(db);
    }

    {
        // aggregate()
        const pipeline = [{$match: matchPredicate}, {$project: {_id: 0, [timeFieldName]: 1}}];
        checkExplain(coll, pipeline, parsedQueryPreds);
        let actual = coll.aggregate(pipeline).toArray();
        assert.sameMembers(expected, actual);
    }
    {
        // find()
        let actual = coll.find(matchPredicate, {_id: 0, [timeFieldName]: 1}).toArray();
        assert.sameMembers(expected, actual);
    }
}

(function() {
'use strict';
var st = new ShardingTest({mongos: 1, shards: 3});
assert.commandWorked(
    st.s.adminCommand({enableSharding: dbName, primaryShard: st.shard0.shardName}));

let createUnshardedOnPrimary = function(db) {
    assert.commandWorked(db.runCommand({
        createUnsplittableCollection: collName,
        dataShard: st.shard0.shardName,
        timeseries: {timeField: timeFieldName}
    }));
    return db.getCollection(collName);
};

let createUnshardedOnNonPrimary = function(db) {
    assert.commandWorked(db.runCommand({
        createUnsplittableCollection: collName,
        dataShard: st.shard1.shardName,
        timeseries: {timeField: timeFieldName}
    }));
    return db.getCollection(collName);
};

let createSharded = function(db) {
    assert.commandWorked(db.adminCommand({
        shardCollection: fullCollName,
        key: {[timeFieldName]: 1},
        timeseries: {timeField: timeFieldName}
    }));
    // Create three chunks over time ranges
    assert.commandWorked(st.splitAt(`${dbName}.${getTimeseriesCollForDDLOps(db, collName)}`,
                                    {"control.min.time": ISODate("1990-01-01")}));
    assert.commandWorked(st.splitAt(`${dbName}.${getTimeseriesCollForDDLOps(db, collName)}`,
                                    {"control.min.time": ISODate("2010-01-01")}));
    return db.getCollection(collName);
};

let moveChunks = function(db) {
    // Move each chunk to its own shard:
    //   minKey -> 1990    shard0
    //   1990   -> 2010    shard1
    //   2010   -> maxKey  shard2
    assert.commandWorked(st.moveChunk(`${dbName}.${getTimeseriesCollForDDLOps(db, collName)}`,
                                      {"control.min.time": ISODate("1990-01-01")},
                                      st.shard1.shardName));
    assert.commandWorked(st.moveChunk(`${dbName}.${getTimeseriesCollForDDLOps(db, collName)}`,
                                      {"control.min.time": ISODate("2010-01-01")},
                                      st.shard2.shardName));
};

let testCases = [
    {
        name: "Unsharded on primary: has extended range data",
        createCollectionFn: createUnshardedOnPrimary,
        docsToInsert: [
            {[timeFieldName]: new Date("1965-01-01")},
            {[timeFieldName]: new Date("1975-01-01")},
            {[timeFieldName]: new Date("1980-01-01")}
        ],
        matchPredicate: {[timeFieldName]: {$lt: new Date("1980-01-01")}},
        parsedQueryPreds: {
            [st.shard0.shardName]: [
                {"control.max.time": {"$_internalExprLt": ISODate("1980-01-01T01:00:00.000Z")}},
                {"control.min.time": {"$_internalExprLt": ISODate("1980-01-01T00:00:00.000Z")}}
            ]
        },
        expected:
            [{[timeFieldName]: new Date("1965-01-01")}, {[timeFieldName]: new Date("1975-01-01")}],
    },
    {
        name: "Unsharded on primary: does not have extended range data",
        createCollectionFn: createUnshardedOnPrimary,
        docsToInsert: [
            {[timeFieldName]: new Date("1971-01-01")},
            {[timeFieldName]: new Date("1975-01-01")},
            {[timeFieldName]: new Date("1980-01-01")}
        ],
        matchPredicate: {[timeFieldName]: {$lt: new Date("1980-01-01")}},
        parsedQueryPreds: {
            [st.shard0.shardName]: [
                {"_id": {"$lt": ObjectId("12cea6000000000000000000")}},
                {"control.max.time": {"$_internalExprLt": ISODate("1980-01-01T01:00:00.000Z")}},
                {"control.min.time": {"$_internalExprLt": ISODate("1980-01-01T00:00:00.000Z")}}
            ]
        },
        expected:
            [{[timeFieldName]: new Date("1971-01-01")}, {[timeFieldName]: new Date("1975-01-01")}],
    },
    {
        name: "Unsharded on primary: does not have extended range data, always true",
        createCollectionFn: createUnshardedOnPrimary,
        docsToInsert: [
            {[timeFieldName]: new Date("1971-01-01")},
            {[timeFieldName]: new Date("1975-01-01")},
            {[timeFieldName]: new Date("1980-01-01")}
        ],
        matchPredicate: {[timeFieldName]: {$gt: new Date("1960-01-01")}},
        // always true: no predicate at all (let everything through)
        parsedQueryPreds: {[st.shard0.shardName]: {}},
        expected: [
            {[timeFieldName]: new Date("1971-01-01")},
            {[timeFieldName]: new Date("1975-01-01")},
            {[timeFieldName]: new Date("1980-01-01")}
        ],
    },
    {
        name: "Unsharded on primary: does not have extended range data, always false",
        createCollectionFn: createUnshardedOnPrimary,
        docsToInsert: [
            {[timeFieldName]: new Date("1971-01-01")},
            {[timeFieldName]: new Date("1975-01-01")},
            {[timeFieldName]: new Date("1980-01-01")}
        ],
        matchPredicate: {[timeFieldName]: {$lt: new Date("1960-01-01")}},
        parsedQueryPreds: {[st.shard0.shardName]: {"$alwaysFalse": 1}},
        expected: [],
    },
    {
        name: "Unsharded on non-primary: has extended range data",
        createCollectionFn: createUnshardedOnNonPrimary,
        docsToInsert: [
            {[timeFieldName]: new Date("1965-01-01")},
            {[timeFieldName]: new Date("1975-01-01")},
            {[timeFieldName]: new Date("1980-01-01")}
        ],
        matchPredicate: {[timeFieldName]: {$lt: new Date("1980-01-01")}},
        parsedQueryPreds: {
            [st.shard1.shardName]: [
                {"control.max.time": {"$_internalExprLt": ISODate("1980-01-01T01:00:00.000Z")}},
                {"control.min.time": {"$_internalExprLt": ISODate("1980-01-01T00:00:00.000Z")}}
            ]
        },
        expected:
            [{[timeFieldName]: new Date("1965-01-01")}, {[timeFieldName]: new Date("1975-01-01")}],
    },
    {
        name: "Unsharded on non-primary: does not have extended range data",
        createCollectionFn: createUnshardedOnNonPrimary,
        docsToInsert: [
            {[timeFieldName]: new Date("1971-01-01")},
            {[timeFieldName]: new Date("1975-01-01")},
            {[timeFieldName]: new Date("1980-01-01")}
        ],
        matchPredicate: {[timeFieldName]: {$lt: new Date("1980-01-01")}},
        parsedQueryPreds: {
            [st.shard1.shardName]: [
                {"_id": {"$lt": ObjectId("12cea6000000000000000000")}},
                {"control.max.time": {"$_internalExprLt": ISODate("1980-01-01T01:00:00.000Z")}},
                {"control.min.time": {"$_internalExprLt": ISODate("1980-01-01T00:00:00.000Z")}}
            ]
        },
        expected:
            [{[timeFieldName]: new Date("1971-01-01")}, {[timeFieldName]: new Date("1975-01-01")}],
    },
    {
        name: "Unsharded on non-primary: does not have extended range data, always true",
        createCollectionFn: createUnshardedOnNonPrimary,
        docsToInsert: [
            {[timeFieldName]: new Date("1971-01-01")},
            {[timeFieldName]: new Date("1975-01-01")},
            {[timeFieldName]: new Date("1980-01-01")}
        ],
        matchPredicate: {[timeFieldName]: {$gt: new Date("1960-01-01")}},
        // always true: no predicate at all (let everything through)
        parsedQueryPreds: {[st.shard1.shardName]: {}},
        expected: [
            {[timeFieldName]: new Date("1971-01-01")},
            {[timeFieldName]: new Date("1975-01-01")},
            {[timeFieldName]: new Date("1980-01-01")}
        ],
    },
    {
        name: "Unsharded on non-primary: does not have extended range data, always false",
        createCollectionFn: createUnshardedOnNonPrimary,
        docsToInsert: [
            {[timeFieldName]: new Date("1971-01-01")},
            {[timeFieldName]: new Date("1975-01-01")},
            {[timeFieldName]: new Date("1980-01-01")}
        ],
        matchPredicate: {[timeFieldName]: {$lt: new Date("1960-01-01")}},
        parsedQueryPreds: {[st.shard1.shardName]: {"$alwaysFalse": 1}},
        expected: [],
    },
    {
        name: "Sharded: data on primary shard, extended range data",
        createCollectionFn: createSharded,
        moveChunksFn: moveChunks,
        docsToInsert: [
            {[timeFieldName]: new Date("1965-01-01")},
            {[timeFieldName]: new Date("1971-01-01")},
        ],
        matchPredicate: {[timeFieldName]: {$lt: new Date("1980-01-01")}},
        parsedQueryPreds: {
            [st.shard0.shardName]: [
                {"control.max.time": {"$_internalExprLt": ISODate("1980-01-01T01:00:00.000Z")}},
                {"control.min.time": {"$_internalExprLt": ISODate("1980-01-01T00:00:00.000Z")}}
            ],
        },
        expected:
            [{[timeFieldName]: new Date("1965-01-01")}, {[timeFieldName]: new Date("1971-01-01")}],
    },
    {
        name: "Sharded: data on primary shard, no extended range data",
        createCollectionFn: createSharded,
        moveChunksFn: moveChunks,
        docsToInsert: [
            {[timeFieldName]: new Date("1971-01-01")},
            {[timeFieldName]: new Date("1975-01-01")},
        ],
        matchPredicate: {[timeFieldName]: {$lt: new Date("1980-01-01")}},
        parsedQueryPreds: {
            [st.shard0.shardName]: [
                {"_id": {"$lt": ObjectId("12cea6000000000000000000")}},
                {"control.max.time": {"$_internalExprLt": ISODate("1980-01-01T01:00:00.000Z")}},
                {"control.min.time": {"$_internalExprLt": ISODate("1980-01-01T00:00:00.000Z")}}
            ],
        },
        expected:
            [{[timeFieldName]: new Date("1971-01-01")}, {[timeFieldName]: new Date("1975-01-01")}],
    },
    {
        name: "Sharded: data on non-primary shard, extended range data",
        createCollectionFn: createSharded,
        moveChunksFn: moveChunks,
        docsToInsert: [
            {[timeFieldName]: new Date("2030-01-01")},
            {[timeFieldName]: new Date("2040-01-01")},
        ],
        matchPredicate: {[timeFieldName]: {$gt: new Date("2020-01-01")}},
        parsedQueryPreds: {
            [st.shard2.shardName]: [
                {"control.max.time": {"$_internalExprGt": ISODate("2020-01-01T00:00:00Z")}},
                {"control.min.time": {"$_internalExprGt": ISODate("2019-12-31T23:00:00Z")}}
            ],
        },
        expected:
            [{[timeFieldName]: new Date("2030-01-01")}, {[timeFieldName]: new Date("2040-01-01")}],
    },
    {
        name: "Sharded: data on non-primary shard, no extended range data",
        createCollectionFn: createSharded,
        moveChunksFn: moveChunks,
        docsToInsert: [
            {[timeFieldName]: new Date("2030-01-01")},
            {[timeFieldName]: new Date("2035-01-01")},
        ],
        matchPredicate: {[timeFieldName]: {$gt: new Date("2020-01-01")}},
        parsedQueryPreds: {
            [st.shard2.shardName]: [
                {"_id": {"$gt": ObjectId("5e0bd2f0ffffffffffffffff")}},
                {"control.max.time": {"$_internalExprGt": ISODate("2020-01-01T00:00:00Z")}},
                {"control.min.time": {"$_internalExprGt": ISODate("2019-12-31T23:00:00Z")}}
            ],
        },
        expected:
            [{[timeFieldName]: new Date("2030-01-01")}, {[timeFieldName]: new Date("2035-01-01")}],
    },
    {
        name: "Sharded: data on two shards including primary",
        createCollectionFn: createSharded,
        moveChunksFn: moveChunks,
        docsToInsert: [
            {[timeFieldName]: new Date("1965-01-01")},
            {[timeFieldName]: new Date("1995-01-01")},
        ],
        matchPredicate: {[timeFieldName]: {$lt: new Date("2000-01-01")}},
        parsedQueryPreds: {
            [st.shard0.shardName]: [
                {"control.max.time": {"$_internalExprLt": ISODate("2000-01-01T01:00:00.000Z")}},
                {"control.min.time": {"$_internalExprLt": ISODate("2000-01-01T00:00:00.000Z")}}
            ],
            [st.shard1.shardName]: [
                // There is an _id predicate here because this shard has no extended range data
                {"_id": {"$lt": ObjectId("386d43800000000000000000")}},
                {"control.max.time": {"$_internalExprLt": ISODate("2000-01-01T01:00:00.000Z")}},
                {"control.min.time": {"$_internalExprLt": ISODate("2000-01-01T00:00:00.000Z")}}
            ]
        },
        expected:
            [{[timeFieldName]: new Date("1965-01-01")}, {[timeFieldName]: new Date("1995-01-01")}],
    },
    {
        name: "Sharded: data on two shards including not including primary",
        createCollectionFn: createSharded,
        moveChunksFn: moveChunks,
        docsToInsert: [
            {[timeFieldName]: new Date("2000-01-01")},
            {[timeFieldName]: new Date("2040-01-01")},
        ],
        matchPredicate: {[timeFieldName]: {$gt: new Date("1995-01-01")}},
        parsedQueryPreds: {
            [st.shard1.shardName]: [
                // There is an _id predicate here because this shard has no extended range data
                {"_id": {"$gt": ObjectId("2f05e270ffffffffffffffff")}},
                {"control.max.time": {"$_internalExprGt": ISODate("1995-01-01T00:00:00Z")}},
                {"control.min.time": {"$_internalExprGt": ISODate("1994-12-31T23:00:00Z")}}
            ],
            [st.shard2.shardName]: [
                {"control.max.time": {"$_internalExprGt": ISODate("1995-01-01T00:00:00Z")}},
                {"control.min.time": {"$_internalExprGt": ISODate("1994-12-31T23:00:00Z")}}
            ]
        },
        expected:
            [{[timeFieldName]: new Date("2000-01-01")}, {[timeFieldName]: new Date("2040-01-01")}],
    },
];

for (let tc of testCases) {
    runTimeSeriesExtendedRangeTest(st, tc);
}

st.stop();
})();
