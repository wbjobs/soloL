#include "Actions/BTAction_Retreat.h"
#include "Blackboard/AIBlackboard.h"
#include "BT/BehaviorTree.h"

BTAction_Retreat::BTAction_Retreat() { SetName("Retreat"); }

BTStatus BTAction_Retreat::Execute(float DeltaTime) {
    BehaviorTree* Tree = GetTree();
    if (!Tree) return BTStatus::Failure;
    AIBlackboard* BB = Tree->GetBlackboard();
    if (!BB) return BTStatus::Failure;
    
    int ArmySize = BB->GetArmySize();
    if (ArmySize <= 0) return BTStatus::Success;
    
    int TotalHealth = 0, TotalMaxHealth = 0;
    for (const auto& U : BB->GetOwnedUnits()) {
        if (U.UnitType != "Worker" && U.bIsAlive) {
            TotalHealth += U.Health;
            TotalMaxHealth += U.MaxHealth;
        }
    }
    
    if (TotalMaxHealth > 0 && static_cast<float>(TotalHealth) / TotalMaxHealth < RetreatThreshold) {
        BB->SetValue("bRetreating", true);
        BB->SetValue("RetreatTarget", BB->GetBasePosition());
        return BTStatus::Success;
    }
    return BTStatus::Failure;
}
