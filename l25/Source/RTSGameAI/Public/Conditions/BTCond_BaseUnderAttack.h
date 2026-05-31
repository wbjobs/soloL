#pragma once
#include "BT/BTCondition.h"

class BTCond_BaseUnderAttack : public BTCondition {
public:
    BTCond_BaseUnderAttack();
    bool IsBaseUnderAttack() const;
};
