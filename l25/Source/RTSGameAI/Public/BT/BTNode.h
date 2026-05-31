#pragma once
#include <vector>
#include <string>
#include <memory>

enum class BTStatus { Success, Failure, Running };

class BehaviorTree;

class BTNode {
public:
    virtual ~BTNode() = default;
    virtual BTStatus Tick(float DeltaTime) = 0;
    virtual void Initialize() {}
    virtual void Terminate(BTStatus /*status*/) {}
    void SetName(const std::string& InName) { Name = InName; }
    const std::string& GetName() const { return Name; }
    void SetParent(BTNode* InParent) { Parent = InParent; }
    BTNode* GetParent() const { return Parent; }
    void SetTree(BehaviorTree* InTree) { Tree = InTree; }
    BehaviorTree* GetTree() const { return Tree; }
protected:
    std::string Name;
    BTNode* Parent = nullptr;
    BehaviorTree* Tree = nullptr;
};
