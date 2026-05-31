#include "Conditions/BTCond_ResourceDepleted.h"
#include "Blackboard/AIBlackboard.h"
#include "BT/BehaviorTree.h"

BTCond_ResourceDepleted::BTCond_ResourceDepleted() { SetName("ResourceDepleted"); }

bool BTCond_ResourceDepleted::IsResourceDepleted() const {
    BehaviorTree* Tree = GetTree();
    if (!Tree) return false;
    AIBlackboard* BB = Tree->GetBlackboard();
    if (!BB) return false;

    if (bCheckAll) {
        return BB->AreAllResourcesDepleted();
    }
    return BB->IsResourceTypeDepleted(static_cast<EResourceType>(TargetResourceType));
}
