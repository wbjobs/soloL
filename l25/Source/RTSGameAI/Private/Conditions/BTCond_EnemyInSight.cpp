#include "Conditions/BTCond_EnemyInSight.h"
#include "Blackboard/AIBlackboard.h"
#include "BT/BehaviorTree.h"

BTCond_EnemyInSight::BTCond_EnemyInSight() { SetName("EnemyInSight"); }

bool BTCond_EnemyInSight::HasEnemiesInSight() const {
    BehaviorTree* Tree = GetTree();
    if (!Tree) return false;
    AIBlackboard* BB = Tree->GetBlackboard();
    if (!BB) return false;
    return !BB->GetVisibleEnemies().empty();
}
