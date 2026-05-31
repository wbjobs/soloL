#include "Controller/AIController.h"
#include "BT/BTSelector.h"
#include "BT/BTSequence.h"
#include "Actions/BTAction_BuildBase.h"
#include "Actions/BTAction_GatherResource.h"
#include "Actions/BTAction_ProduceUnit.h"
#include "Actions/BTAction_Attack.h"
#include "Actions/BTAction_Retreat.h"
#include "Conditions/BTCond_HasResources.h"
#include "Conditions/BTCond_EnemyInSight.h"
#include "Conditions/BTCond_BaseUnderAttack.h"
#include "Conditions/BTCond_ArmyReady.h"
#include "Conditions/BTCond_ResourceDepleted.h"
#include "Decorators/BTDecorator_Cooldown.h"
#include "Decorators/BTDecorator_Inverter.h"
#include "Decorators/BTDecorator_Repeat.h"
#include <iostream>
#include <cmath>
#include <chrono>

AIController::AIController() = default;
AIController::~AIController() { Shutdown(); }

bool AIController::Initialize(EAIDifficulty Difficulty) {
    CurrentDifficulty = Difficulty;
    
    Blackboard = std::make_unique<AIBlackboard>();
    BT = std::make_unique<BehaviorTree>();
    NavMesh = std::make_unique<NavMeshPathfinding>();
    Perception = std::make_unique<VisionPerception>();
    LuaManager = std::make_unique<LuaBindingManager>();
    ParamConfig = std::make_unique<AIParamConfig>();
    MetricsDB = std::make_unique<BattleMetricsDB>();
    HTTPServer = std::make_unique<AIHTTPServer>();
    
    FNavMeshConfig NavConfig;
    NavMesh->Initialize(NavConfig);
    NavMesh->SetNavMeshBounds(FVector(-5000, -5000, 0), FVector(5000, 5000, 100));
    
    FPerceptionConfig PerceptConfig;
    PerceptConfig.VisionRadius = 1500.f;
    PerceptConfig.FieldOfView = 360.f;
    PerceptConfig.UpdateInterval = 0.5f;
    Perception->Initialize(PerceptConfig);
    
    if (!LuaManager->Initialize()) {
        std::cerr << "Failed to initialize Lua bindings" << std::endl;
        return false;
    }
    
    LuaManager->RegisterBlackboard(Blackboard.get());
    LuaManager->RegisterBehaviorTree(BT.get());
    LuaManager->RegisterNavMesh(NavMesh.get());
    LuaManager->RegisterPerception(Perception.get());
    
    ParamConfig->LoadFromJSON("Config/ai_params.json");
    MetricsDB->Open("Config/battle_metrics.db");
    
    HTTPServer->SetConfig(ParamConfig.get());
    HTTPServer->SetMetricsDB(MetricsDB.get());
    HTTPServer->SetOnParamsUpdatedCallback([this]() { HotReloadParams(); });
    
    ApplyDifficultySettings();
    
    Blackboard->SetBasePosition(FVector(0, 0, 0));
    Blackboard->SetResource(EResourceType::Gold, 2000);
    Blackboard->SetResource(EResourceType::Wood, 1500);
    Blackboard->SetResource(EResourceType::Food, 1000);
    Blackboard->SetResource(EResourceType::Stone, 500);
    Blackboard->SetValue("bRetreating", false);
    
    SpawnInitialUnits();
    SpawnResourceNodes();
    BuildDefaultBehaviorTree();
    BuildNavMeshForTest();
    
    BattleStartTime = 0.f;
    BattleElapsedTime = 0.f;
    bBattleActive = true;
    
    return true;
}

void AIController::ApplyDifficultySettings() {
    switch (CurrentDifficulty) {
        case EAIDifficulty::Easy:
            ResourceGatherInterval = 3.0f;
            PerceptionUpdateInterval = 1.0f;
            break;
        case EAIDifficulty::Normal:
            ResourceGatherInterval = 2.0f;
            PerceptionUpdateInterval = 0.5f;
            break;
        case EAIDifficulty::Hard:
            ResourceGatherInterval = 1.2f;
            PerceptionUpdateInterval = 0.3f;
            break;
        case EAIDifficulty::Insane:
            ResourceGatherInterval = 0.8f;
            PerceptionUpdateInterval = 0.15f;
            break;
    }
}

void AIController::SpawnInitialUnits() {
    FBuildingInfo Base;
    Base.BuildingId = NextBuildingId++;
    Base.BuildingType = "Base";
    Base.Position = FVector(0, 0, 0);
    Base.BuildProgress = 1.0f;
    Base.bIsComplete = true;
    Blackboard->AddOwnedBuilding(Base);
    
    for (int i = 0; i < 5; ++i) {
        FUnitInfo Worker;
        Worker.UnitId = NextUnitId++;
        Worker.UnitType = "Worker";
        Worker.Position = FVector(static_cast<float>(i) * 100.f - 200.f, 100.f, 0);
        Worker.Health = 50;
        Worker.MaxHealth = 50;
        Worker.bIsAlive = true;
        Blackboard->AddOwnedUnit(Worker);
    }
}

void AIController::BuildDefaultBehaviorTree() {
    auto Root = std::make_shared<BTSelector>();
    Root->SetName("RootSelector");
    
    auto ResourceDepletedSequence = std::make_shared<BTSequence>();
    ResourceDepletedSequence->SetName("ResourceDepletedSequence");
    
    auto AllResourcesDepletedCond = std::make_shared<BTCond_ResourceDepleted>();
    AllResourcesDepletedCond->SetCheckAllResources(true);
    AllResourcesDepletedCond->SetPredicate([this, AllResourcesDepletedCond]() { return AllResourcesDepletedCond->IsResourceDepleted(); });
    
    auto DefenseModeAction = std::make_shared<BTAction_Retreat>();
    
    ResourceDepletedSequence->AddChild(AllResourcesDepletedCond);
    ResourceDepletedSequence->AddChild(DefenseModeAction);
    
    auto DefendSequence = std::make_shared<BTSequence>();
    DefendSequence->SetName("DefendSequence");
    
    auto BaseUnderAttackCond = std::make_shared<BTCond_BaseUnderAttack>();
    BaseUnderAttackCond->SetPredicate([this]() { return BaseUnderAttackCond->IsBaseUnderAttack(); });
    
    auto DefendAction = std::make_shared<BTAction_Attack>();
    auto RetreatAction = std::make_shared<BTAction_Retreat>();
    
    DefendSequence->AddChild(BaseUnderAttackCond);
    DefendSequence->AddChild(DefendAction);
    
    auto AttackSequence = std::make_shared<BTSequence>();
    AttackSequence->SetName("AttackSequence");
    
    auto EnemyInSightCond = std::make_shared<BTCond_EnemyInSight>();
    EnemyInSightCond->SetPredicate([this]() { return EnemyInSightCond->HasEnemiesInSight(); });
    
    auto ArmyReadyCond = std::make_shared<BTCond_ArmyReady>();
    ArmyReadyCond->SetRequiredArmySize(3);
    ArmyReadyCond->SetPredicate([this, ArmyReadyCond]() { return ArmyReadyCond->IsArmyReady(); });
    
    AttackSequence->AddChild(EnemyInSightCond);
    AttackSequence->AddChild(ArmyReadyCond);
    AttackSequence->AddChild(DefendAction);
    
    auto EconomySequence = std::make_shared<BTSequence>();
    EconomySequence->SetName("EconomySequence");
    
    auto NotDepletedCond = std::make_shared<BTCond_ResourceDepleted>();
    NotDepletedCond->SetCheckAllResources(true);
    NotDepletedCond->SetPredicate([this, NotDepletedCond]() { return !NotDepletedCond->IsResourceDepleted(); });
    
    auto NotDepletedInverter = std::make_shared<BTDecorator_Inverter>();
    NotDepletedInverter->SetChild(NotDepletedCond);
    
    auto GatherGold = std::make_shared<BTAction_GatherResource>();
    GatherGold->SetResourceType(static_cast<int>(EResourceType::Gold));
    
    auto GatherWood = std::make_shared<BTAction_GatherResource>();
    GatherWood->SetResourceType(static_cast<int>(EResourceType::Wood));
    
    auto GatherFood = std::make_shared<BTAction_GatherResource>();
    GatherFood->SetResourceType(static_cast<int>(EResourceType::Food));
    
    auto BuildResources = std::make_shared<BTSelector>();
    BuildResources->SetName("GatherSelector");
    BuildResources->AddChild(GatherGold);
    BuildResources->AddChild(GatherWood);
    BuildResources->AddChild(GatherFood);
    
    auto GatherCooldown = std::make_shared<BTDecorator_Cooldown>();
    GatherCooldown->SetCooldownDuration(ResourceGatherInterval);
    GatherCooldown->SetChild(BuildResources);
    
    auto BuildSequence = std::make_shared<BTSequence>();
    BuildSequence->SetName("BuildSequence");
    
    auto BuildResourcesCond = std::make_shared<BTCond_HasResources>();
    BuildResourcesCond->SetRequiredGold(200);
    BuildResourcesCond->SetRequiredWood(150);
    BuildResourcesCond->SetPredicate([this, BuildResourcesCond]() { return BuildResourcesCond->CheckResources(); });
    
    auto BuildBase = std::make_shared<BTAction_BuildBase>();
    
    BuildSequence->AddChild(BuildResourcesCond);
    BuildSequence->AddChild(BuildBase);
    
    auto ProductionSequence = std::make_shared<BTSequence>();
    ProductionSequence->SetName("ProductionSequence");
    
    auto ProductionResourcesCond = std::make_shared<BTCond_HasResources>();
    ProductionResourcesCond->SetRequiredGold(100);
    ProductionResourcesCond->SetRequiredFood(50);
    ProductionResourcesCond->SetPredicate([this, ProductionResourcesCond]() { return ProductionResourcesCond->CheckResources(); });
    
    auto ProduceSoldier = std::make_shared<BTAction_ProduceUnit>();
    ProduceSoldier->SetUnitType("Soldier");
    ProduceSoldier->SetGoldCost(100);
    ProduceSoldier->SetFoodCost(50);
    ProduceSoldier->SetProductionTime(3.0f);
    
    ProductionSequence->AddChild(ProductionResourcesCond);
    ProductionSequence->AddChild(ProduceSoldier);
    
    EconomySequence->AddChild(NotDepletedInverter);
    EconomySequence->AddChild(GatherCooldown);
    EconomySequence->AddChild(BuildSequence);
    EconomySequence->AddChild(ProductionSequence);
    
    Root->AddChild(ResourceDepletedSequence);
    Root->AddChild(DefendSequence);
    Root->AddChild(AttackSequence);
    Root->AddChild(RetreatAction);
    Root->AddChild(EconomySequence);
    
    auto RepeatRoot = std::make_shared<BTDecorator_Repeat>();
    RepeatRoot->SetChild(Root);
    
    BT->SetRoot(RepeatRoot);
    BT->SetBlackboard(Blackboard.get());
}

bool AIController::LoadBehaviorTreeFromLua(const std::string& ScriptPath) {
    return LuaManager->LoadScript(ScriptPath);
}

void AIController::BuildNavMeshForTest() {
    float Vertices[] = {
        -5000, -5000, 0,  5000, -5000, 0,  5000, 5000, 0,  -5000, 5000, 0
    };
    int Triangles[] = { 0, 1, 2,  0, 2, 3 };
    NavMesh->BuildNavMesh(Vertices, 4, Triangles, 6);
}

void AIController::Update(float DeltaTime) {
    if (!Blackboard || !BT) return;
    
    if (bBattleActive) {
        BattleElapsedTime += DeltaTime;
    }
    
    UpdatePerception(DeltaTime);
    UpdateResources(DeltaTime);
    UpdateUnits(DeltaTime);
    CheckResourceDepletion();
    HandleBuildingChanges();
    
    NavMeshRebuildTimer += DeltaTime;
    if (NavMeshRebuildTimer >= NavMeshRebuildInterval) {
        NavMeshRebuildTimer = 0.f;
        if (NavMesh && NavMesh->IsDirty()) {
            for (const auto& Building : Blackboard->GetOwnedBuildings()) {
                if (Building.bIsComplete) {
                    NavMesh->AddBuildingObstacle(Building);
                }
            }
            NavMesh->RebuildWithDynamicObstacles();
        }
    }
    
    Blackboard->SetVisibleEnemies(Perception->GetVisibleEnemies());
    
    BT->Tick(DeltaTime);
    LuaManager->CallTick(DeltaTime);
}

void AIController::UpdatePerception(float DeltaTime) {
    PerceptionTimer += DeltaTime;
    if (PerceptionTimer >= PerceptionUpdateInterval) {
        PerceptionTimer = 0.f;
        Perception->Update(PerceptionUpdateInterval, Blackboard->GetBasePosition(), PlayerUnits);
    }
}

void AIController::UpdateResources(float DeltaTime) {
}

void AIController::UpdateUnits(float DeltaTime) {
}

void AIController::SpawnResourceNodes() {
    struct FNodeTemplate { EResourceType Type; float X; float Y; int Amount; };
    FNodeTemplate Templates[] = {
        { EResourceType::Gold,  800,  0,    500 },
        { EResourceType::Gold,  1200, 400,  500 },
        { EResourceType::Gold,  600, -500,  300 },
        { EResourceType::Wood,  0,    800,  600 },
        { EResourceType::Wood, -400,  600,  400 },
        { EResourceType::Wood,  300,  1000, 300 },
        { EResourceType::Food, -600,  0,    500 },
        { EResourceType::Food, -800, -400,  400 },
        { EResourceType::Food, -300, -700,  300 },
        { EResourceType::Stone, 500, -800,  200 },
        { EResourceType::Stone, 900, -600,  200 },
    };
    
    for (const auto& Tmpl : Templates) {
        FResourceNode Node;
        Node.NodeId = NextResourceNodeId++;
        Node.Type = Tmpl.Type;
        Node.Position = FVector(Tmpl.X, Tmpl.Y, 0);
        Node.RemainingAmount = Tmpl.Amount;
        Node.MaxAmount = Tmpl.Amount;
        Node.bIsDepleted = false;
        Blackboard->AddResourceNode(Node);
    }
    
    LastBuildingCount = static_cast<int>(Blackboard->GetOwnedBuildings().size());
}

void AIController::CheckResourceDepletion() {
    if (!Blackboard) return;
    
    bool bAllDepleted = Blackboard->AreAllResourcesDepleted();
    if (bAllDepleted && !bDefenseModeTriggered) {
        bDefenseModeTriggered = true;
        Blackboard->SetDefenseMode(true);
        Blackboard->SetValue("bDefenseMode", true);
        std::cout << "[AIController] ALL RESOURCE NODES DEPLETED! Switching to defense mode." << std::endl;
    } else if (!bAllDepleted && bDefenseModeTriggered) {
        bDefenseModeTriggered = false;
        Blackboard->SetDefenseMode(false);
        Blackboard->SetValue("bDefenseMode", false);
        std::cout << "[AIController] Resource nodes available again. Exiting defense mode." << std::endl;
    }
}

void AIController::HandleBuildingChanges() {
    if (!Blackboard || !NavMesh) return;
    
    int CurrentBuildingCount = static_cast<int>(Blackboard->GetOwnedBuildings().size());
    if (CurrentBuildingCount != LastBuildingCount) {
        NavMesh->SetDirty(true);
        LastBuildingCount = CurrentBuildingCount;
    }
}

void AIController::OnPlayerUnitDetected(const FUnitInfo& Unit) {
}

void AIController::OnPlayerUnitLost(int UnitId) {
}

void AIController::PrintDebugInfo() const {
    if (!Blackboard) return;
    
    std::cout << "=== AI Status ===" << std::endl;
    std::cout << "Difficulty: ";
    switch (CurrentDifficulty) {
        case EAIDifficulty::Easy: std::cout << "Easy"; break;
        case EAIDifficulty::Normal: std::cout << "Normal"; break;
        case EAIDifficulty::Hard: std::cout << "Hard"; break;
        case EAIDifficulty::Insane: std::cout << "Insane"; break;
    }
    std::cout << std::endl;
    
    std::cout << "Resources: Gold=" << Blackboard->GetResource(EResourceType::Gold)
              << " Wood=" << Blackboard->GetResource(EResourceType::Wood)
              << " Food=" << Blackboard->GetResource(EResourceType::Food) << std::endl;
    
    std::cout << "Workers: " << Blackboard->GetWorkerCount() << std::endl;
    std::cout << "Army Size: " << Blackboard->GetArmySize() << std::endl;
    std::cout << "Visible Enemies: " << Blackboard->GetVisibleEnemies().size() << std::endl;
    std::cout << "Buildings: " << Blackboard->GetOwnedBuildings().size() << std::endl;
    std::cout << "Resource Nodes Active: " 
              << Blackboard->GetResourceNodes().size() - Blackboard->GetTotalDepletedNodeCount() 
              << "/" << Blackboard->GetResourceNodes().size() << std::endl;
    std::cout << "Gold Nodes: " << Blackboard->GetActiveNodeCount(EResourceType::Gold)
              << " | Wood Nodes: " << Blackboard->GetActiveNodeCount(EResourceType::Wood)
              << " | Food Nodes: " << Blackboard->GetActiveNodeCount(EResourceType::Food) << std::endl;
    std::cout << "Defense Mode: " << (Blackboard->IsInDefenseMode() ? "ACTIVE" : "Off") << std::endl;
    std::cout << "NavMesh Dirty: " << (NavMesh && NavMesh->IsDirty() ? "Yes" : "No") << std::endl;
    if (ParamConfig) {
        std::cout << "HTTP Server: " << (HTTPServer && HTTPServer->IsRunning() ? "Running" : "Stopped") << std::endl;
        std::cout << "Battle Metrics: " << (MetricsDB ? std::to_string(MetricsDB->GetTotalBattleCount()) + " records" : "N/A") << std::endl;
    }
    std::cout << "=================" << std::endl;
}

bool AIController::StartHTTPServer(int Port) {
    if (!HTTPServer) return false;
    return HTTPServer->Start(Port, "127.0.0.1");
}

void AIController::StopHTTPServer() {
    if (HTTPServer) {
        HTTPServer->Stop();
    }
}

void AIController::EndBattle(bool bVictory, const std::string& EnemyName) {
    bBattleActive = false;
    if (!MetricsDB || !ParamConfig) return;
    
    BattleRecord Record;
    Record.Timestamp = std::chrono::duration_cast<std::chrono::seconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    Record.MapName = CurrentMapName;
    Record.AIName = CurrentAIName;
    Record.EnemyName = EnemyName;
    Record.bVictory = bVictory;
    Record.BattleDurationSeconds = static_cast<int>(BattleElapsedTime);
    Record.AIFinalUnits = Blackboard->GetArmySize() + Blackboard->GetWorkerCount();
    Record.EnemyFinalUnits = static_cast<int>(PlayerUnits.size());
    Record.Params = ParamConfig->ToBattleParams();
    
    if (MetricsDB->InsertBattleRecord(Record)) {
        std::cout << "[AIController] Battle recorded: " << (bVictory ? "VICTORY" : "DEFEAT") 
                  << " | Duration: " << Record.BattleDurationSeconds << "s" << std::endl;
    }
}

void AIController::ApplyOptimizedParams() {
    if (!MetricsDB || !ParamConfig) return;
    auto Optimal = MetricsDB->GetOptimizedParams(0.6f);
    ParamConfig->ApplyBattleParams(Optimal);
    HotReloadParams();
    std::cout << "[AIController] Applied optimized parameters from battle history" << std::endl;
}

void AIController::HotReloadParams() {
    if (!ParamConfig) return;
    
    std::cout << "[HotReload] Applying parameter changes..." << std::endl;
    
    ResourceGatherInterval = ParamConfig->GetParam("GatherInterval", 2.0f);
    
    const auto& Dirty = ParamConfig->GetDirtyParams();
    for (const auto& Key : Dirty) {
        std::cout << "[HotReload] Updated: " << Key << std::endl;
    }
    
    if (!Dirty.empty()) {
        ParamConfig->ClearDirty();
        ParamConfig->SaveToJSON("Config/ai_params.json");
    }
    
    Blackboard->SetValue("ParamsHotReloaded", true);
    std::cout << "[HotReload] Complete" << std::endl;
}

bool AIController::SaveBattleMetrics(const std::string& DBPath) {
    if (!MetricsDB) return false;
    return MetricsDB->ExportToJSON(DBPath + ".json");
}

bool AIController::LoadParamConfig(const std::string& ConfigPath) {
    if (!ParamConfig) return false;
    bool Success = ParamConfig->LoadFromJSON(ConfigPath);
    if (Success) {
        HotReloadParams();
    }
    return Success;
}

bool AIController::SaveParamConfig(const std::string& ConfigPath) const {
    if (!ParamConfig) return false;
    return ParamConfig->SaveToJSON(ConfigPath);
}

void AIController::Shutdown() {
    StopHTTPServer();
    if (MetricsDB) MetricsDB->Close();
    if (ParamConfig && ParamConfig->IsDirty()) {
        ParamConfig->SaveToJSON("Config/ai_params.json");
    }
    HTTPServer.reset();
    MetricsDB.reset();
    ParamConfig.reset();
    LuaManager.reset();
    Perception.reset();
    NavMesh.reset();
    BT.reset();
    Blackboard.reset();
}
