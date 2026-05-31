#pragma once
#include <string>
#include <functional>
#include <unordered_map>
#include <memory>
#include <thread>
#include <atomic>
#include "Config/AIParamConfig.h"
#include "ML/BattleMetricsDB.h"

namespace httplib {
    class Server;
}

class AIHTTPServer {
public:
    AIHTTPServer();
    ~AIHTTPServer();

    bool Start(int Port = 8080, const std::string& Host = "0.0.0.0");
    void Stop();
    bool IsRunning() const { return bRunning; }

    void SetConfig(AIParamConfig* InConfig) { Config = InConfig; }
    void SetMetricsDB(BattleMetricsDB* InDB) { MetricsDB = InDB; }

    void SetOnParamsUpdatedCallback(std::function<void()> Callback) { OnParamsUpdated = std::move(Callback); }

    std::string GetLastError() const { return LastError; }

private:
    void SetupRoutes();
    void RunServer();

    std::string HandleGetParams(const httplib::Server* svr, const httplib::Request* req, httplib::Response* res);
    std::string HandlePostParams(const httplib::Server* svr, const httplib::Request* req, httplib::Response* res);
    std::string HandleGetMetrics(const httplib::Server* svr, const httplib::Request* req, httplib::Response* res);
    std::string HandleGetOptimized(const httplib::Server* svr, const httplib::Request* req, httplib::Response* res);
    std::string HandlePostReload(const httplib::Server* svr, const httplib::Request* req, httplib::Response* res);
    std::string HandlePostBattle(const httplib::Server* svr, const httplib::Request* req, httplib::Response* res);

    std::unique_ptr<httplib::Server> Server;
    std::thread ServerThread;
    std::atomic<bool> bRunning{false};
    int ListenPort = 8080;
    std::string ListenHost;
    std::string LastError;

    AIParamConfig* Config = nullptr;
    BattleMetricsDB* MetricsDB = nullptr;
    std::function<void()> OnParamsUpdated;
};
