#pragma once
#include "BT/BTCondition.h"

class BTCond_HasResources : public BTCondition {
public:
    BTCond_HasResources();
    void SetRequiredGold(int Gold) { RequiredGold = Gold; }
    void SetRequiredWood(int Wood) { RequiredWood = Wood; }
    void SetRequiredFood(int Food) { RequiredFood = Food; }
    bool CheckResources() const;
private:
    int RequiredGold = 0;
    int RequiredWood = 0;
    int RequiredFood = 0;
};
