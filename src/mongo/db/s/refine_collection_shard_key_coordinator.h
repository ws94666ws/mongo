/**
 *    Copyright (C) 2021-present MongoDB, Inc.
 *
 *    This program is free software: you can redistribute it and/or modify
 *    it under the terms of the Server Side Public License, version 1,
 *    as published by MongoDB, Inc.
 *
 *    This program is distributed in the hope that it will be useful,
 *    but WITHOUT ANY WARRANTY; without even the implied warranty of
 *    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *    Server Side Public License for more details.
 *
 *    You should have received a copy of the Server Side Public License
 *    along with this program. If not, see
 *    <http://www.mongodb.com/licensing/server-side-public-license>.
 *
 *    As a special exception, the copyright holders give permission to link the
 *    code of portions of this program with the OpenSSL library under certain
 *    conditions as described in each individual source file and distribute
 *    linked combinations including the program with the OpenSSL library. You
 *    must comply with the Server Side Public License in all respects for
 *    all of the code used other than as permitted herein. If you modify file(s)
 *    with this exception, you may extend this exception to your version of the
 *    file(s), but you are not obligated to do so. If you do not wish to do so,
 *    delete this exception statement from your version. If you delete this
 *    exception statement from all source files in the program, then also delete
 *    it in the license file.
 */

#pragma once

#include "mongo/base/status.h"
#include "mongo/base/string_data.h"
#include "mongo/bson/bsonobj.h"
#include "mongo/bson/bsonobjbuilder.h"
#include "mongo/db/keypattern.h"
#include "mongo/db/query/write_ops/write_ops.h"
#include "mongo/db/s/refine_collection_shard_key_coordinator_document_gen.h"
#include "mongo/db/s/sharding_ddl_coordinator.h"
#include "mongo/db/s/sharding_ddl_coordinator_service.h"
#include "mongo/executor/scoped_task_executor.h"
#include "mongo/s/request_types/sharded_ddl_commands_gen.h"
#include "mongo/util/assert_util.h"
#include "mongo/util/cancellation.h"
#include "mongo/util/future.h"
#include "mongo/util/uuid.h"

#include <memory>

#include <boost/move/utility_core.hpp>
#include <boost/optional/optional.hpp>

namespace mongo {

class RefineCollectionShardKeyCoordinator
    : public RecoverableShardingDDLCoordinator<RefineCollectionShardKeyCoordinatorDocument,
                                               RefineCollectionShardKeyCoordinatorPhaseEnum> {
public:
    using StateDoc = RefineCollectionShardKeyCoordinatorDocument;
    using Phase = RefineCollectionShardKeyCoordinatorPhaseEnum;

    RefineCollectionShardKeyCoordinator(ShardingDDLCoordinatorService* service,
                                        const BSONObj& initialState);

    void checkIfOptionsConflict(const BSONObj& coorDoc) const override;

    void appendCommandInfo(BSONObjBuilder* cmdInfoBuilder) const override;

private:
    StringData serializePhase(const Phase& phase) const override {
        return RefineCollectionShardKeyCoordinatorPhase_serializer(phase);
    }

    bool _mustAlwaysMakeProgress() override {
        return _doc.getPhase() > Phase::kRemoteIndexValidation;
    }

    void _performNoopWriteOnDataShardsAndConfigServer(
        OperationContext* opCtx,
        const NamespaceString& nss,
        const OperationSessionInfo& osi,
        const std::shared_ptr<executor::TaskExecutor>& executor);

    ExecutorFuture<void> _runImpl(std::shared_ptr<executor::ScopedTaskExecutor> executor,
                                  const CancellationToken& token) noexcept override;

    const mongo::RefineCollectionShardKeyRequest _request;

    // Critical section reason.
    const BSONObj _critSecReason;
};

}  // namespace mongo
