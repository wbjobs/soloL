#include "Actions/BTAction_Attack.h"
#include "Blackboard/AIBlackboard.h"
#include "BT/BehaviorTree.h"

BTAction_Attack::BTAction_Attack() { SetName("Attack"); }

BTStatus BTAction_Attack::Execute(float DeltaTime) {
    BehaviorTree* Tree = GetTree();
    if (!Tree) return BTStatus::Failure;
    AIBlackboard* BB = Tree->GetBlackboard();
    if (!BB) return BTStatus::Failure;
    
    const auto& Enemies = BB->GetVisibleEnemies();
    if (Enemies.empty()) return BTStatus::Failure;
    
    int ArmySize = BB->GetArmySize();
    if (ArmySize <= 0) return BTStatus::Failure;
    
    CooldownTimer += DeltaTime;
    if (CooldownTimer >= AttackCooldown) {
        CooldownTimer = 0.f;
        BB->SetValue("LastAttackTarget", Enemies[0].Position);
        BB->SetValue("AttackTargetId", Enemies[0].UnitId);
        return BTStatus::Success;
    }
    return BTStatus::Running;
}
