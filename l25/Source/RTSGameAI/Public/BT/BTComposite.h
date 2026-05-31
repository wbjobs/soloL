#pragma once
#include "BT/BTNode.h"
#include <vector>
#include <memory>

class BTComposite : public BTNode {
public:
    void AddChild(std::shared_ptr<BTNode> Child) {
        Child->SetParent(this);
        Children.push_back(std::move(Child));
    }
    const std::vector<std::shared_ptr<BTNode>>& GetChildren() const { return Children; }
protected:
    std::vector<std::shared_ptr<BTNode>> Children;
    size_t CurrentChildIndex = 0;
};
