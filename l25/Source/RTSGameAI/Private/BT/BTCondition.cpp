#include "BT/BTCondition.h"

BTStatus BTCondition::Tick(float /*DeltaTime*/) {
    if (ConditionPredicate && ConditionPredicate()) {
        return BTStatus::Success;
    }
    return BTStatus::Failure;
}
