#include "Actions/BTAction_GatherResource.h"
#include "Blackboard/AIBlackboard.h"
#include "BT/BehaviorTree.h"
#include <iostream>

BTAction_GatherResource::BTAction_GatherResource() { SetName("GatherResource"); }

BTStatus BTAction_GatherResource::Execute(float DeltaTime) {
    BehaviorTree* Tree = GetTree();
    if (!Tree) return BTStatus::Failure;
    AIBlackboard* BB = Tree->GetBlackboard();
    if (!BB) return BTStatus::Failure;

    int WorkerCount = BB->GetWorkerCount();
    if (WorkerCount <= 0) return BTStatus::Failure;

    EResourceType ResType = static_cast<EResourceType>(TargetResourceType);

    if (BB->IsResourceTypeDepleted(ResType)) {
        if (ConsecutiveEmptyTicks == 0) {
            const char* TypeName = "Unknown";
            switch (ResType) {
                case EResourceType::Gold: TypeName = "Gold"; break;
                case EResourceType::Wood: TypeName = "Wood"; break;
                case EResourceType::Food: TypeName = "Food"; break;
                case EResourceType::Stone: TypeName = "Stone"; break;
            }
            std::cout << "[GatherResource] " << TypeName << " nodes depleted! Switching strategy." << std::endl;
        }
        ConsecutiveEmptyTicks++;
        GatherTimer = 0.f;
        CurrentTargetNodeId = -1;
        return BTStatus::Failure;
    }

    FResourceNode* TargetNode = nullptr;
    if (CurrentTargetNodeId >= 0) {
        for (auto& Node : BB->GetResourceNodes()) {
            if (Node.NodeId == CurrentTargetNodeId && !Node.bIsDepleted) {
                TargetNode = &Node;
                break;
            }
        }
    }
    if (!TargetNode) {
        TargetNode = BB->FindNearestActiveNode(ResType, BB->GetBasePosition());
        if (TargetNode) {
            CurrentTargetNodeId = TargetNode->NodeId;
        }
    }

    if (!TargetNode) {
        ConsecutiveEmptyTicks++;
        return BTStatus::Failure;
    }

    ConsecutiveEmptyTicks = 0;

    GatherTimer += DeltaTime;
    if (GatherTimer >= GatherInterval) {
        GatherTimer = 0.f;
        int Amount = GatherAmount * WorkerCount;
        if (Amount > TargetNode->RemainingAmount) {
            Amount = TargetNode->RemainingAmount;
        }
        BB->ModifyResource(ResType, Amount);

        TargetNode->RemainingAmount -= Amount;
        if (TargetNode->RemainingAmount <= 0) {
            BB->MarkNodeDepleted(TargetNode->NodeId);
            CurrentTargetNodeId = -1;
        }
        return BTStatus::Success;
    }
    return BTStatus::Running;
}
