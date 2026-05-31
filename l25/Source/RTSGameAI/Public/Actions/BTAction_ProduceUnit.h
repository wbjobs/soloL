#pragma once
#include "BT/BTAction.h"
#include <string>

class BTAction_ProduceUnit : public BTAction {
public:
    BTAction_ProduceUnit();
    void SetUnitType(const std::string& Type) { UnitTypeToProduce = Type; }
    void SetGoldCost(int Cost) { GoldCost = Cost; }
    void SetFoodCost(int Cost) { FoodCost = Cost; }
    void SetProductionTime(float Time) { ProductionTime = Time; }
protected:
    BTStatus Execute(float DeltaTime) override;
private:
    std::string UnitTypeToProduce = "Soldier";
    int GoldCost = 100;
    int FoodCost = 50;
    float ProductionTime = 3.f;
    float CurrentProductionTime = 0.f;
    bool bIsProducing = false;
};
