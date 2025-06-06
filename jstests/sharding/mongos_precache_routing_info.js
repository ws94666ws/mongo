// create
import {ShardingTest} from "jstests/libs/shardingtest.js";

var s = new ShardingTest({
    shards: 2,
    other: {
        mongosOptions:
            {setParameter: {'failpoint.skipClusterParameterRefresh': "{'mode':'alwaysOn'}"}}
    }
});
var db = s.getDB("test");
var ss = db.serverStatus();

const shardCommand = {
    shardcollection: "test.foo",
    key: {num: 1}
};

// shard
assert.commandWorked(s.s0.adminCommand({enablesharding: "test"}));
assert.commandWorked(s.s0.adminCommand(shardCommand));

// split numSplits times
const numSplits = 2;
var i;
for (i = 0; i < numSplits; i++) {
    var midKey = {num: i};
    assert.commandWorked(s.s0.adminCommand({split: "test.foo", middle: midKey}));
}

// restart the router
s.restartRouterNode(0);
db = s.getDB("test");

// check for # refreshes started
ss = db.serverStatus();
assert.eq(1, ss.shardingStatistics.catalogCache.countFullRefreshesStarted);

// does not pre cache when set parameter is disabled
s.restartRouterNode(0, {
    restart: true,
    setParameter: {
        loadRoutingTableOnStartup: false,
        'failpoint.skipClusterParameterRefresh': "{'mode':'alwaysOn'}"
    },
});
db = s.getDB("test");

// check for # refreshes started
ss = db.serverStatus();
assert.eq(0, ss.shardingStatistics.catalogCache.countFullRefreshesStarted);

s.stop();
