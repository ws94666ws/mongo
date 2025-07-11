/**
 *    Copyright (C) 2022-present MongoDB, Inc.
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

#include "mongo/base/string_data.h"
#include "mongo/bson/bsonobjbuilder.h"
#include "mongo/db/s/metrics/sharding_data_transform_cumulative_metrics.h"
#include "mongo/db/s/resharding/resharding_cumulative_metrics_field_name_provider.h"

#include <mutex>

#include <boost/optional/optional.hpp>

namespace mongo {

class ReshardingCumulativeMetrics : public ShardingDataTransformCumulativeMetrics {
public:
    using Base = ShardingDataTransformCumulativeMetrics;

    ReshardingCumulativeMetrics();
    ReshardingCumulativeMetrics(const std::string& rootName);

    static boost::optional<StringData> fieldNameFor(AnyState state);
    void reportForServerStatus(BSONObjBuilder* bob) const override;

    void onStarted(bool isSameKeyResharding, const UUID& reshardingUUID);
    void onSuccess(bool isSameKeyResharding, const UUID& reshardingUUID);
    void onFailure(bool isSameKeyResharding, const UUID& reshardingUUID);
    void onCanceled(bool isSameKeyResharding, const UUID& reshardingUUID);

private:
    void reportActive(BSONObjBuilder* bob) const override;
    void reportLatencies(BSONObjBuilder* bob) const override;
    void reportCurrentInSteps(BSONObjBuilder* bob) const override;

    const ReshardingCumulativeMetricsFieldNameProvider* _fieldNames;

    AtomicWord<int64_t> _countSameKeyStarted{0};
    AtomicWord<int64_t> _countSameKeySucceeded{0};
    AtomicWord<int64_t> _countSameKeyFailed{0};
    AtomicWord<int64_t> _countSameKeyCancelled{0};

    std::set<UUID> _activeReshardingOperations;
    std::mutex _activeReshardingOperationsMutex;
};

}  // namespace mongo
