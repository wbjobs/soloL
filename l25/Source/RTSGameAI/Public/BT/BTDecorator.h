#pragma once
#include "BT/BTNode.h"
#include <memory>

class BTDecorator : public BTNode {
public:
    void SetChild(std::shared_ptr<BTNode> InChild) {
        InChild->SetParent(this);
        Child = std::move(InChild);
    }
    BTNode* GetChild() const { return Child.get(); }
protected:
    std::shared_ptr<BTNode> Child;
};
