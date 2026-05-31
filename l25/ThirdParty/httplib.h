#pragma once
#include <string>
#include <map>
#include <vector>
#include <functional>
#include <memory>
#include <sstream>
#include <cstring>
#include <iostream>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32.lib")
using ssize_t = SSIZE_T;
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <fcntl.h>
using SOCKET = int;
#define INVALID_SOCKET (-1)
#define SOCKET_ERROR (-1)
#endif

namespace httplib {

struct Request {
    std::string method;
    std::string path;
    std::map<std::string, std::string> headers;
    std::string body;
    std::map<std::string, std::string> params;
};

struct Response {
    int status = 200;
    std::map<std::string, std::string> headers;
    std::string body;

    void set_content(const std::string& b, const std::string& type) {
        body = b;
        headers["Content-Type"] = type;
        headers["Content-Length"] = std::to_string(b.size());
    }

    void set_header(const std::string& key, const std::string& val) {
        headers[key] = val;
    }
};

using Handler = std::function<void(const Request&, Response&)>;

class Server {
public:
    Server() : running_(false) {
#ifdef _WIN32
        WSADATA wsa;
        WSAStartup(MAKEWORD(2, 2), &wsa);
#endif
    }

    ~Server() {
        stop();
#ifdef _WIN32
        WSACleanup();
#endif
    }

    void Get(const std::string& pattern, Handler h) {
        handlers_["GET " + pattern] = std::move(h);
    }

    void Post(const std::string& pattern, Handler h) {
        handlers_["POST " + pattern] = std::move(h);
    }

    void set_error_handler(Handler h) {
        error_handler_ = std::move(h);
    }

    bool listen(const char* host, int port) {
        SOCKET s = socket(AF_INET, SOCK_STREAM, 0);
        if (s == INVALID_SOCKET) return false;

        int opt = 1;
        setsockopt(s, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));

        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port = htons(static_cast<uint16_t>(port));
        inet_pton(AF_INET, host, &addr.sin_addr);

        if (bind(s, (sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
#ifdef _WIN32
            closesocket(s);
#else
            close(s);
#endif
            return false;
        }

        if (::listen(s, 5) == SOCKET_ERROR) {
#ifdef _WIN32
            closesocket(s);
#else
            close(s);
#endif
            return false;
        }

        listen_fd_ = s;
        running_ = true;

        while (running_) {
            sockaddr_in client{};
            socklen_t len = sizeof(client);
            SOCKET client_fd = accept(s, (sockaddr*)&client, &len);
            if (client_fd == INVALID_SOCKET) break;

            handle_client(client_fd);
        }

#ifdef _WIN32
        closesocket(s);
#else
        close(s);
#endif
        return true;
    }

    void stop() {
        running_ = false;
    }

private:
    void handle_client(SOCKET fd) {
        char buf[16384];
        std::string request_str;

        while (true) {
            ssize_t n = recv(fd, buf, sizeof(buf) - 1, 0);
            if (n <= 0) break;
            buf[n] = 0;
            request_str += buf;
            if (request_str.find("\r\n\r\n") != std::string::npos) break;
        }

        Request req;
        Response res;

        size_t pos = request_str.find(' ');
        if (pos != std::string::npos) {
            req.method = request_str.substr(0, pos);
            size_t pos2 = request_str.find(' ', pos + 1);
            if (pos2 != std::string::npos) {
                req.path = request_str.substr(pos + 1, pos2 - pos - 1);
            }
        }

        size_t header_end = request_str.find("\r\n\r\n");
        if (header_end != std::string::npos) {
            std::string header_part = request_str.substr(0, header_end);
            req.body = request_str.substr(header_end + 4);

            size_t line_start = header_part.find("\r\n");
            while (line_start != std::string::npos) {
                size_t line_end = header_part.find("\r\n", line_start + 2);
                std::string line = header_part.substr(line_start + 2, (line_end != std::string::npos ? line_end : header_part.size()) - line_start - 2);
                size_t colon = line.find(':');
                if (colon != std::string::npos) {
                    std::string key = line.substr(0, colon);
                    std::string val = line.substr(colon + 2);
                    req.headers[key] = val;
                }
                line_start = line_end;
            }
        }

        auto handler_it = handlers_.find(req.method + " " + req.path);
        if (handler_it != handlers_.end()) {
            handler_it->second(req, res);
        } else if (req.method == "POST") {
            for (const auto& h : handlers_) {
                if (h.first.substr(0, 5) == "POST " && req.path.find(h.first.substr(5)) == 0) {
                    h.second(req, res);
                    break;
                }
            }
        }

        std::ostringstream oss;
        oss << "HTTP/1.1 " << res.status << " OK\r\n";
        oss << "Connection: close\r\n";
        oss << "Access-Control-Allow-Origin: *\r\n";
        for (const auto& h : res.headers) {
            oss << h.first << ": " << h.second << "\r\n";
        }
        oss << "\r\n" << res.body;

        std::string response = oss.str();
        send(fd, response.c_str(), static_cast<int>(response.size()), 0);

#ifdef _WIN32
        closesocket(fd);
#else
        close(fd);
#endif
    }

    SOCKET listen_fd_ = INVALID_SOCKET;
    bool running_;
    std::map<std::string, Handler> handlers_;
    Handler error_handler_;
};

} // namespace httplib
