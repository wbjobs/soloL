#include "BT/BehaviorTree.h"
#include "Blackboard/AIBlackboard.h"
#include "BT/BTComposite.h"
#include "BT/BTDecorator.h"

void BehaviorTree::SetRoot(std::shared_ptr<BTNode> InRoot) {
    Root = std::move(InRoot);
    PropagateTreeToNodes();
}

void BehaviorTree::PropagateTreeToNodes() {
    if (Root) {
        SetTreeOnNodeRecursive(Root.get());
    }
}

void BehaviorTree::SetTreeOnNodeRecursive(BTNode* Node) {
    if (!Node) return;
    Node->SetTree(this);
    
    if (auto* Composite = dynamic_cast<BTComposite*>(Node)) {
        for (const auto& Child : Composite->GetChildren()) {
            SetTreeOnNodeRecursive(Child.get());
        }
    }
    
    if (auto* Decorator = dynamic_cast<BTDecorator*>(Node)) {
        SetTreeOnNodeRecursive(Decorator->GetChild());
    }
}

BTStatus BehaviorTree::Tick(float DeltaTime) {
    if (!Root) return BTStatus::Failure;
    return Root->Tick(DeltaTime);
}
