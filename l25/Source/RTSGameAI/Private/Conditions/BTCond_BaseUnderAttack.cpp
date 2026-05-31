#include "Conditions/BTCond_BaseUnderAttack.h"
#include "Blackboard/AIBlackboard.h"
#include "BT/BehaviorTree.h"

BTCond_BaseUnderAttack::BTCond_BaseUnderAttack() { SetName("BaseUnderAttack"); }

bool BTCond_BaseUnderAttack::IsBaseUnderAttack() const {
    BehaviorTree* Tree = GetTree();
    if (!Tree) return false;
    AIBlackboard* BB = Tree->GetBlackboard();
    if (!BB) return false;
    return BB->IsBaseUnderAttack();
}
