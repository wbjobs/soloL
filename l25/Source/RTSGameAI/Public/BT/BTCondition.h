#pragma once
#include "BT/BTNode.h"
#include <functional>

class BTCondition : public BTNode {
public:
    using Predicate = std::function<bool()>;
    void SetPredicate(Predicate InPredicate) { ConditionPredicate = std::move(InPredicate); }
    BTStatus Tick(float DeltaTime) override;
private:
    Predicate ConditionPredicate;
};
