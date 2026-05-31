#include "Conditions/BTCond_HasResources.h"
#include "Blackboard/AIBlackboard.h"
#include "BT/BehaviorTree.h"

BTCond_HasResources::BTCond_HasResources() { SetName("HasResources"); }

bool BTCond_HasResources::CheckResources() const {
    BehaviorTree* Tree = GetTree();
    if (!Tree) return false;
    AIBlackboard* BB = Tree->GetBlackboard();
    if (!BB) return false;
    return BB->GetResource(EResourceType::Gold) >= RequiredGold &&
           BB->GetResource(EResourceType::Wood) >= RequiredWood &&
           BB->GetResource(EResourceType::Food) >= RequiredFood;
}
