//
// ssl/detail/handshake_op.hpp
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~
//
// Copyright (c) 2003-2017 Christopher M. Kohlhoff (chris at kohlhoff dot com)
//
// Distributed under the Boost Software License, Version 1.0. (See accompanying
// file LICENSE_1_0.txt or copy at http://www.boost.org/LICENSE_1_0.txt)
//

#ifndef ASIO_SSL_DETAIL_HANDSHAKE_OP_HPP
#define ASIO_SSL_DETAIL_HANDSHAKE_OP_HPP

#if defined(_MSC_VER) && (_MSC_VER >= 1200)
#pragma once
#endif  // defined(_MSC_VER) && (_MSC_VER >= 1200)

#include "mongo/util/net/ssl/detail/engine.hpp"

#include <asio/detail/config.hpp>

// This must be after all other includes
#include <asio/detail/push_options.hpp>

namespace asio {
namespace ssl {
namespace detail {

class handshake_op {
public:
    handshake_op(stream_base::handshake_type type) : type_(type) {}

    engine::want operator()(engine& eng,
                            asio::error_code& ec,
                            std::size_t& bytes_transferred) const {
        bytes_transferred = 0;
        return eng.handshake(type_, ec);
    }

    template <typename Handler>
    void call_handler(Handler& handler, const asio::error_code& ec, const std::size_t&) const {
        handler(ec);
    }

private:
    stream_base::handshake_type type_;
};

}  // namespace detail
}  // namespace ssl
}  // namespace asio

#include <asio/detail/pop_options.hpp>

#endif  // ASIO_SSL_DETAIL_HANDSHAKE_OP_HPP
