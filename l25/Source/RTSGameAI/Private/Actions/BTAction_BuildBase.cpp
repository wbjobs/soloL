#include "Actions/BTAction_BuildBase.h"
#include "Blackboard/AIBlackboard.h"
#include "BT/BehaviorTree.h"

BTAction_BuildBase::BTAction_BuildBase() { SetName("BuildBase"); }

BTStatus BTAction_BuildBase::Execute(float DeltaTime) {
    BehaviorTree* Tree = GetTree();
    if (!Tree) return BTStatus::Failure;
    AIBlackboard* BB = Tree->GetBlackboard();
    if (!BB) return BTStatus::Failure;

    int BarracksCount = 0;
    for (const auto& B : BB->GetOwnedBuildings()) {
        if (B.BuildingType == "Barracks" && B.bIsComplete) BarracksCount++;
    }

    if (BarracksCount >= MaxBarracksCount) return BTStatus::Success;

    if (BB->GetResource(EResourceType::Gold) < 200 || BB->GetResource(EResourceType::Wood) < 150) {
        return BTStatus::Failure;
    }

    BuildTimer += DeltaTime;
    if (BuildTimer >= BuildInterval) {
        BuildTimer = 0.f;
        BB->ModifyResource(EResourceType::Gold, -200);
        BB->ModifyResource(EResourceType::Wood, -150);
        FBuildingInfo NewBarracks;
        NewBarracks.BuildingId = static_cast<int>(BB->GetOwnedBuildings().size()) + 100;
        NewBarracks.BuildingType = "Barracks";
        NewBarracks.Position = BB->GetBasePosition();
        NewBarracks.Position.X += static_cast<float>(BarracksCount) * 300.f;
        NewBarracks.BuildProgress = 1.0f;
        NewBarracks.bIsComplete = true;
        BB->AddOwnedBuilding(NewBarracks);
        return BTStatus::Success;
    }
    return BTStatus::Running;
}
