#include "Conditions/BTCond_ArmyReady.h"
#include "Blackboard/AIBlackboard.h"
#include "BT/BehaviorTree.h"

BTCond_ArmyReady::BTCond_ArmyReady() { SetName("ArmyReady"); }

bool BTCond_ArmyReady::IsArmyReady() const {
    BehaviorTree* Tree = GetTree();
    if (!Tree) return false;
    AIBlackboard* BB = Tree->GetBlackboard();
    if (!BB) return false;
    return BB->GetArmySize() >= RequiredSize;
}
