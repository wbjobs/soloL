#pragma once
#include "BT/BTNode.h"
#include <memory>
#include <string>

class AIBlackboard;

class BehaviorTree {
public:
    BehaviorTree() = default;
    void SetRoot(std::shared_ptr<BTNode> InRoot);
    BTNode* GetRoot() const { return Root.get(); }
    BTStatus Tick(float DeltaTime);
    void SetBlackboard(class AIBlackboard* InBB) { Blackboard = InBB; }
    AIBlackboard* GetBlackboard() const { return Blackboard; }
    void PropagateTreeToNodes();
private:
    void SetTreeOnNodeRecursive(BTNode* Node);
    std::shared_ptr<BTNode> Root;
    AIBlackboard* Blackboard = nullptr;
};
