#pragma once
#include "BT/BTCondition.h"

class BTCond_EnemyInSight : public BTCondition {
public:
    BTCond_EnemyInSight();
    bool HasEnemiesInSight() const;
};
