/**
 *    Copyright (C) 2025-present MongoDB, Inc.
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

#include "mongo/replay/session_pool.h"

using namespace mongo;

// TODO SERVER-106046 will handle dynamic session creation and deletion/recycle of them.
SessionPool::SessionPool(size_t size) : _stop(false) {
    for (size_t i = 0; i < size; ++i) {
        _workers.emplace_back([this]() {
            while (true) {
                Task task;

                // Queue management with a lock
                {
                    stdx::unique_lock<stdx::mutex> lock(_queueMutex);
                    _condition.wait(lock, [this] { return _stop.load() || !_tasks.empty(); });

                    if (_stop.load() && _tasks.empty()) {
                        return;
                    }

                    task = std::move(_tasks.front());
                    _tasks.pop();
                }

                // Execute the task
                task();
            }
        });
    }
}

SessionPool::~SessionPool() {
    _stop.store(true);
    // Notify all sessions to stop
    _condition.notify_all();
    for (auto& worker : _workers) {
        // Ensure all threads (sessions) are joined before destructing
        worker.join();
    }
}
