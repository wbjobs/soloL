#include <iostream>
#include <chrono>
#include <thread>
#include <csignal>
#include "Controller/AIController.h"

volatile sig_atomic_t g_Shutdown = 0;

void SignalHandler(int /*signal*/) {
    g_Shutdown = 1;
}

void SimulateGameLoop(AIController& AI, int DurationSeconds) {
    std::cout << "Starting RTS AI simulation for " << DurationSeconds << " seconds..." << std::endl;
    std::cout << "Initial state:" << std::endl;
    AI.PrintDebugInfo();
    
    const float DeltaTime = 0.1f;
    const int TicksPerSecond = static_cast<int>(1.0f / DeltaTime);
    int TotalTicks = DurationSeconds * TicksPerSecond;
    
    for (int Tick = 0; Tick < TotalTicks; ++Tick) {
        if (Tick % (TicksPerSecond * 5) == 0 && Tick > 0) {
            std::cout << "\nTick " << Tick << " (" << Tick / TicksPerSecond << "s):" << std::endl;
            AI.PrintDebugInfo();
        }
        
        AI.Update(DeltaTime);
        
        std::this_thread::sleep_for(std::chrono::milliseconds(static_cast<int>(DeltaTime * 100)));
    }
    
    std::cout << "\nFinal state:" << std::endl;
    AI.PrintDebugInfo();
}

int main(int argc, char* argv[]) {
    std::cout << "=== RTS Game AI System with ML Parameter Tuning ===" << std::endl;
    std::cout << "HTTP API Server + SQLite Battle Metrics + Hot Reload" << std::endl;
    std::cout << std::endl;
    
    bool bEnableHTTPServer = true;
    int HTTPPort = 8080;
    bool bInteractive = false;
    int SimDuration = 30;
    
    for (int i = 1; i < argc; ++i) {
        std::string Arg = argv[i];
        if (Arg == "--no-http") {
            bEnableHTTPServer = false;
        } else if (Arg == "--port" && i + 1 < argc) {
            HTTPPort = std::atoi(argv[++i]);
        } else if (Arg == "--duration" && i + 1 < argc) {
            SimDuration = std::atoi(argv[++i]);
        } else if (Arg == "--interactive") {
            bInteractive = true;
        }
    }
    
    signal(SIGINT, SignalHandler);
    
    AIController AI;
    if (!AI.Initialize(EAIDifficulty::Normal)) {
        std::cerr << "Failed to initialize AI controller" << std::endl;
        return 1;
    }
    
    if (bEnableHTTPServer) {
        std::cout << "[HTTP] Starting server on port " << HTTPPort << "..." << std::endl;
        AI.StartHTTPServer(HTTPPort);
        std::cout << "[HTTP] Server running. API endpoints:" << std::endl;
        std::cout << "  GET  http://localhost:" << HTTPPort << "/api/params" << std::endl;
        std::cout << "  POST http://localhost:" << HTTPPort << "/api/params (JSON body)" << std::endl;
        std::cout << "  GET  http://localhost:" << HTTPPort << "/api/metrics" << std::endl;
        std::cout << "  GET  http://localhost:" << HTTPPort << "/api/optimized" << std::endl;
        std::cout << "  POST http://localhost:" << HTTPPort << "/api/reload" << std::endl;
        std::cout << "  POST http://localhost:" << HTTPPort << "/api/battle" << std::endl;
        std::cout << "  GET  http://localhost:" << HTTPPort << "/health" << std::endl;
        std::cout << std::endl;
    }
    
    std::vector<FUnitInfo> PlayerUnits;
    
    FUnitInfo PlayerSoldier;
    PlayerSoldier.UnitId = 1;
    PlayerSoldier.UnitType = "Soldier";
    PlayerSoldier.Position = FVector(3000, 0, 0);
    PlayerSoldier.Health = 100;
    PlayerSoldier.MaxHealth = 100;
    PlayerSoldier.bIsAlive = true;
    PlayerUnits.push_back(PlayerSoldier);
    
    FUnitInfo PlayerArcher;
    PlayerArcher.UnitId = 2;
    PlayerArcher.UnitType = "Archer";
    PlayerArcher.Position = FVector(3500, 500, 0);
    PlayerArcher.Health = 80;
    PlayerArcher.MaxHealth = 80;
    PlayerArcher.bIsAlive = true;
    PlayerUnits.push_back(PlayerArcher);
    
    AI.SetPlayerUnits(PlayerUnits);
    
    std::cout << "Player units spawned at: " << std::endl;
    for (const auto& U : PlayerUnits) {
        std::cout << "  - " << U.UnitType << " ID=" << U.UnitId 
                  << " Pos=(" << U.Position.X << "," << U.Position.Y << "," << U.Position.Z << ")" << std::endl;
    }
    std::cout << std::endl;
    
    if (bInteractive) {
        std::cout << "[Interactive Mode] Press Ctrl+C to exit" << std::endl;
        const float DeltaTime = 0.1f;
        while (!g_Shutdown) {
            AI.Update(DeltaTime);
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
        std::cout << "\nShutting down..." << std::endl;
    } else {
        SimulateGameLoop(AI, SimDuration);
    }
    
    AI.EndBattle(true, "Player");
    
    if (AI.GetMetricsDB()) {
        std::cout << "\n[Metrics] Total battles recorded: " << AI.GetMetricsDB()->GetTotalBattleCount() << std::endl;
        std::cout << "[Metrics] Win rate: " << (AI.GetMetricsDB()->CalculateWinRate() * 100) << "%" << std::endl;
    }
    
    std::cout << "\n=== Simulation Complete ===" << std::endl;
    std::cout << "Python ML Optimization (run separately):" << std::endl;
    std::cout << "  cd ML && python param_optimizer.py --db ../Config/battle_metrics.db" << std::endl;
    std::cout << "  cd ML && python push_params_to_unreal.py --host localhost --port 8080" << std::endl;
    
    return 0;
}
