#pragma once
#include "BT/BTCondition.h"

class BTCond_ArmyReady : public BTCondition {
public:
    BTCond_ArmyReady();
    void SetRequiredArmySize(int Size) { RequiredSize = Size; }
    bool IsArmyReady() const;
private:
    int RequiredSize = 5;
};
