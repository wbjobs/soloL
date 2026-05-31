#include "Actions/BTAction_ProduceUnit.h"
#include "Blackboard/AIBlackboard.h"
#include "BT/BehaviorTree.h"

BTAction_ProduceUnit::BTAction_ProduceUnit() { SetName("ProduceUnit"); }

BTStatus BTAction_ProduceUnit::Execute(float DeltaTime) {
    BehaviorTree* Tree = GetTree();
    if (!Tree) return BTStatus::Failure;
    AIBlackboard* BB = Tree->GetBlackboard();
    if (!BB) return BTStatus::Failure;

    if (!bIsProducing) {
        if (BB->GetResource(EResourceType::Gold) < GoldCost || BB->GetResource(EResourceType::Food) < FoodCost) {
            return BTStatus::Failure;
        }
        BB->ModifyResource(EResourceType::Gold, -GoldCost);
        BB->ModifyResource(EResourceType::Food, -FoodCost);
        bIsProducing = true;
        CurrentProductionTime = 0.f;
    }

    CurrentProductionTime += DeltaTime;
    if (CurrentProductionTime >= ProductionTime) {
        bIsProducing = false;
        CurrentProductionTime = 0.f;
        FUnitInfo NewUnit;
        NewUnit.UnitId = static_cast<int>(BB->GetOwnedUnits().size()) + 1000;
        NewUnit.UnitType = UnitTypeToProduce;
        NewUnit.Position = BB->GetBasePosition();
        NewUnit.Position.X += 200.f;
        NewUnit.Health = 100;
        NewUnit.MaxHealth = 100;
        NewUnit.bIsAlive = true;
        BB->AddOwnedUnit(NewUnit);
        return BTStatus::Success;
    }
    return BTStatus::Running;
}
