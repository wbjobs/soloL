#include "HTTP/AIHTTPServer.h"
#include "../../ThirdParty/httplib.h"
#include "../../ThirdParty/nlohmann/json.hpp"
#include <sstream>
#include <iostream>

using json = nlohmann::json;

AIHTTPServer::AIHTTPServer() = default;

AIHTTPServer::~AIHTTPServer() {
    Stop();
}

bool AIHTTPServer::Start(int Port, const std::string& Host) {
    ListenPort = Port;
    ListenHost = Host;
    bRunning = true;
    ServerThread = std::thread(&AIHTTPServer::RunServer, this);
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    return bRunning.load();
}

void AIHTTPServer::Stop() {
    bRunning = false;
    if (Server) {
        Server->stop();
    }
    if (ServerThread.joinable()) {
        ServerThread.join();
    }
    Server.reset();
}

void AIHTTPServer::SetupRoutes() {
    if (!Server) return;

    Server->Get("/api/params", [this](const httplib::Request& req, httplib::Response& res) {
        HandleGetParams(Server.get(), &req, &res);
    });

    Server->Post("/api/params", [this](const httplib::Request& req, httplib::Response& res) {
        HandlePostParams(Server.get(), &req, &res);
    });

    Server->Get("/api/metrics", [this](const httplib::Request& req, httplib::Response& res) {
        HandleGetMetrics(Server.get(), &req, &res);
    });

    Server->Get("/api/optimized", [this](const httplib::Request& req, httplib::Response& res) {
        HandleGetOptimized(Server.get(), &req, &res);
    });

    Server->Post("/api/reload", [this](const httplib::Request& req, httplib::Response& res) {
        HandlePostReload(Server.get(), &req, &res);
    });

    Server->Post("/api/battle", [this](const httplib::Request& req, httplib::Response& res) {
        HandlePostBattle(Server.get(), &req, &res);
    });

    Server->Get("/health", [](const httplib::Request&, httplib::Response& res) {
        json J;
        J["status"] = "ok";
        J["service"] = "rts-ai-param-server";
        res.set_content(J.dump(), "application/json");
    });

    Server->set_error_handler([](const httplib::Request&, httplib::Response& res) {
        json J;
        J["error"] = "Not found";
        J["code"] = res.status;
        res.set_content(J.dump(), "application/json");
    });
}

std::string AIHTTPServer::HandleGetParams(const httplib::Server* svr, const httplib::Request* req, httplib::Response* res) {
    json J;
    if (Config) {
        for (const auto& Name : Config->GetAllParamNames()) {
            try {
                if (Config->HasParam(Name)) {
                    if (auto* F = std::any_cast<float>(&Config->GetParam<std::any>(Name))) {
                        J[Name] = *F;
                    } else if (auto* I = std::any_cast<int>(&Config->GetParam<std::any>(Name))) {
                        J[Name] = *I;
                    } else if (auto* B = std::any_cast<bool>(&Config->GetParam<std::any>(Name))) {
                        J[Name] = *B;
                    }
                }
            } catch (...) {}
        }
    }
    res->set_content(J.dump(2), "application/json");
    return "";
}

std::string AIHTTPServer::HandlePostParams(const httplib::Server* svr, const httplib::Request* req, httplib::Response* res) {
    try {
        json J = json::parse(req->body);
        if (!Config) {
            res->status = 500;
            json Err; Err["error"] = "Config not available";
            res->set_content(Err.dump(), "application/json");
            return "";
        }
        for (json::iterator It = J.begin(); It != J.end(); ++It) {
            if (It.value().is_number_float()) {
                Config->SetParam(It.key(), static_cast<float>(It.value()));
            } else if (It.value().is_number_integer()) {
                Config->SetParam(It.key(), static_cast<int>(It.value()));
            } else if (It.value().is_boolean()) {
                Config->SetParam(It.key(), static_cast<bool>(It.value()));
            }
        }
        if (OnParamsUpdated) {
            OnParamsUpdated();
        }
        json Result;
        Result["status"] = "success";
        Result["applied"] = J.size();
        res->set_content(Result.dump(), "application/json");
    } catch (...) {
        res->status = 400;
        json Err; Err["error"] = "Invalid JSON";
        res->set_content(Err.dump(), "application/json");
    }
    return "";
}

std::string AIHTTPServer::HandleGetMetrics(const httplib::Server* svr, const httplib::Request* req, httplib::Response* res) {
    json J;
    if (MetricsDB) {
        J["total_battles"] = MetricsDB->GetTotalBattleCount();
        J["victories"] = MetricsDB->GetVictoryCount();
        J["defeats"] = MetricsDB->GetDefeatCount();
        J["win_rate"] = MetricsDB->CalculateWinRate();
    } else {
        J["total_battles"] = 0;
        J["victories"] = 0;
        J["defeats"] = 0;
        J["win_rate"] = 0.0;
    }
    res->set_content(J.dump(2), "application/json");
    return "";
}

std::string AIHTTPServer::HandleGetOptimized(const httplib::Server* svr, const httplib::Request* req, httplib::Response* res) {
    json J;
    if (MetricsDB) {
        auto Params = MetricsDB->GetOptimizedParams(0.6f);
        J["attack_army_threshold"] = Params.AttackArmyThreshold;
        J["defense_army_threshold"] = Params.DefenseArmyThreshold;
        J["reserve_ratio"] = Params.ResourceReserveRatio;
        J["worker_soldier_ratio"] = Params.WorkerToSoldierRatio;
        J["build_priority"] = Params.BuildPriorityWeight;
        J["gather_priority"] = Params.GatherPriorityWeight;
        J["aggression"] = Params.AggressionLevel;
        J["expansion_rate"] = Params.ExpansionRate;
        J["retreat_threshold"] = Params.RetreatHealthThreshold;
        J["vision_multiplier"] = Params.VisionRadiusMultiplier;
    }
    res->set_content(J.dump(2), "application/json");
    return "";
}

std::string AIHTTPServer::HandlePostReload(const httplib::Server* svr, const httplib::Request* req, httplib::Response* res) {
    json J;
    J["status"] = "reloaded";
    if (OnParamsUpdated) {
        OnParamsUpdated();
    }
    res->set_content(J.dump(), "application/json");
    return "";
}

std::string AIHTTPServer::HandlePostBattle(const httplib::Server* svr, const httplib::Request* req, httplib::Response* res) {
    try {
        json J = json::parse(req->body);
        BattleRecord Record;
        if (J.contains("victory")) Record.bVictory = J["victory"];
        if (J.contains("map_name")) Record.MapName = J["map_name"].get<std::string>();
        if (J.contains("duration")) Record.BattleDurationSeconds = J["duration"];
        if (Config) {
            Record.Params = Config->ToBattleParams();
        }
        bool Success = MetricsDB ? MetricsDB->InsertBattleRecord(Record) : false;
        json Result;
        Result["status"] = Success ? "recorded" : "failed";
        Result["id"] = static_cast<int64_t>(Record.BattleId);
        res->set_content(Result.dump(), "application/json");
    } catch (...) {
        res->status = 400;
        json Err; Err["error"] = "Invalid JSON";
        res->set_content(Err.dump(), "application/json");
    }
    return "";
}

void AIHTTPServer::RunServer() {
    Server = std::make_unique<httplib::Server>();
    SetupRoutes();
    std::cout << "[HTTP] Server starting on " << ListenHost << ":" << ListenPort << std::endl;
    bool bOK = Server->listen(ListenHost.c_str(), ListenPort);
    if (!bOK) {
        LastError = "Failed to bind to port";
        std::cerr << "[HTTP] " << LastError << std::endl;
    }
    bRunning = false;
}
