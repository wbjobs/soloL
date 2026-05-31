#pragma once
#include <memory>
#include <vector>
#include <string>
#include "Blackboard/AIBlackboard.h"
#include "BT/BehaviorTree.h"
#include "Navigation/NavMeshPathfinding.h"
#include "Perception/VisionPerception.h"
#include "Lua/LuaBindingManager.h"
#include "Config/AIParamConfig.h"
#include "ML/BattleMetricsDB.h"
#include "HTTP/AIHTTPServer.h"

enum class EAIDifficulty { Easy, Normal, Hard, Insane };

class AIController {
public:
    AIController();
    ~AIController();
    
    bool Initialize(EAIDifficulty Difficulty = EAIDifficulty::Normal);
    void Update(float DeltaTime);
    void Shutdown();
    
    void SetPlayerUnits(const std::vector<FUnitInfo>& Units) { PlayerUnits = Units; }
    const std::vector<FUnitInfo>& GetPlayerUnits() const { return PlayerUnits; }
    
    AIBlackboard* GetBlackboard() const { return Blackboard.get(); }
    BehaviorTree* GetBehaviorTree() const { return BT.get(); }
    NavMeshPathfinding* GetNavMesh() const { return NavMesh.get(); }
    VisionPerception* GetPerception() const { return Perception.get(); }
    LuaBindingManager* GetLuaManager() const { return LuaManager.get(); }
    
    void SetDifficulty(EAIDifficulty Difficulty) { CurrentDifficulty = Difficulty; }
    EAIDifficulty GetDifficulty() const { return CurrentDifficulty; }
    
    void OnPlayerUnitDetected(const FUnitInfo& Unit);
    void OnPlayerUnitLost(int UnitId);
    
    void BuildDefaultBehaviorTree();
    bool LoadBehaviorTreeFromLua(const std::string& ScriptPath);
    
    void SpawnInitialUnits();
    void SpawnResourceNodes();
    void BuildNavMeshForTest();
    
    void PrintDebugInfo() const;
    void CheckResourceDepletion();

    AIParamConfig* GetParamConfig() const { return ParamConfig.get(); }
    BattleMetricsDB* GetMetricsDB() const { return MetricsDB.get(); }
    AIHTTPServer* GetHTTPServer() const { return HTTPServer.get(); }

    bool StartHTTPServer(int Port = 8080);
    void StopHTTPServer();

    void EndBattle(bool bVictory, const std::string& EnemyName = "Player");
    void ApplyOptimizedParams();
    void HotReloadParams();

    bool SaveBattleMetrics(const std::string& DBPath);
    bool LoadParamConfig(const std::string& ConfigPath);
    bool SaveParamConfig(const std::string& ConfigPath) const;

private:
    void ApplyDifficultySettings();
    void UpdatePerception(float DeltaTime);
    void UpdateResources(float DeltaTime);
    void UpdateUnits(float DeltaTime);
    void HandleBuildingChanges();
    
    EAIDifficulty CurrentDifficulty = EAIDifficulty::Normal;
    std::unique_ptr<AIBlackboard> Blackboard;
    std::unique_ptr<BehaviorTree> BT;
    std::unique_ptr<NavMeshPathfinding> NavMesh;
    std::unique_ptr<VisionPerception> Perception;
    std::unique_ptr<LuaBindingManager> LuaManager;
    std::unique_ptr<AIParamConfig> ParamConfig;
    std::unique_ptr<BattleMetricsDB> MetricsDB;
    std::unique_ptr<AIHTTPServer> HTTPServer;
    
    std::vector<FUnitInfo> PlayerUnits;
    float ResourceGatherInterval = 2.f;
    float ResourceGatherTimer = 0.f;
    float PerceptionUpdateInterval = 0.5f;
    float PerceptionTimer = 0.f;
    float NavMeshRebuildTimer = 0.f;
    float NavMeshRebuildInterval = 5.f;
    int NextUnitId = 1000;
    int NextBuildingId = 100;
    int NextResourceNodeId = 1;
    int LastBuildingCount = 0;
    bool bDefenseModeTriggered = false;
    float BattleStartTime = 0.f;
    float BattleElapsedTime = 0.f;
    bool bBattleActive = false;
    std::string CurrentMapName = "DefaultMap";
    std::string CurrentAIName = "RTS_AI";
};
