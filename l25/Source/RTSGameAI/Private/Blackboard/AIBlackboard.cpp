#include "Blackboard/AIBlackboard.h"
#include <algorithm>
#include <cmath>
#include <cfloat>

int AIBlackboard::GetResource(EResourceType Type) const {
    auto It = Resources.find(Type);
    return It != Resources.end() ? It->second : 0;
}

void AIBlackboard::ModifyResource(EResourceType Type, int Delta) {
    Resources[Type] = GetResource(Type) + Delta;
    if (Resources[Type] < 0) Resources[Type] = 0;
}

void AIBlackboard::SetResource(EResourceType Type, int Amount) {
    Resources[Type] = Amount;
}

void AIBlackboard::RemoveOwnedUnit(int UnitId) {
    OwnedUnits.erase(
        std::remove_if(OwnedUnits.begin(), OwnedUnits.end(),
            [UnitId](const FUnitInfo& U) { return U.UnitId == UnitId; }),
        OwnedUnits.end());
}

void AIBlackboard::RemoveOwnedBuilding(int BuildingId) {
    OwnedBuildings.erase(
        std::remove_if(OwnedBuildings.begin(), OwnedBuildings.end(),
            [BuildingId](const FBuildingInfo& B) { return B.BuildingId == BuildingId; }),
        OwnedBuildings.end());
}

int AIBlackboard::GetArmySize() const {
    int Count = 0;
    for (const auto& U : OwnedUnits) {
        if (U.UnitType != "Worker" && U.bIsAlive) Count++;
    }
    return Count;
}

int AIBlackboard::GetWorkerCount() const {
    int Count = 0;
    for (const auto& U : OwnedUnits) {
        if (U.UnitType == "Worker" && U.bIsAlive) Count++;
    }
    return Count;
}

bool AIBlackboard::IsBaseUnderAttack() const {
    for (const auto& B : OwnedBuildings) {
        if (B.bIsUnderAttack) return true;
    }
    return false;
}

FVector AIBlackboard::GetNearestEnemyPosition() const {
    if (VisibleEnemies.empty()) return BasePosition;
    FVector Nearest = VisibleEnemies[0].Position;
    float MinDist = BasePosition.DistanceTo(Nearest);
    for (size_t i = 1; i < VisibleEnemies.size(); ++i) {
        float Dist = BasePosition.DistanceTo(VisibleEnemies[i].Position);
        if (Dist < MinDist) {
            MinDist = Dist;
            Nearest = VisibleEnemies[i].Position;
        }
    }
    return Nearest;
}

void AIBlackboard::RemoveDepletedNodes() {
    ResourceNodes.erase(
        std::remove_if(ResourceNodes.begin(), ResourceNodes.end(),
            [](const FResourceNode& N) { return N.bIsDepleted; }),
        ResourceNodes.end());
}

bool AIBlackboard::IsResourceTypeDepleted(EResourceType Type) const {
    for (const auto& Node : ResourceNodes) {
        if (Node.Type == Type && !Node.bIsDepleted) return false;
    }
    return true;
}

bool AIBlackboard::AreAllResourcesDepleted() const {
    for (const auto& Node : ResourceNodes) {
        if (!Node.bIsDepleted) return false;
    }
    return !ResourceNodes.empty();
}

int AIBlackboard::GetActiveNodeCount(EResourceType Type) const {
    int Count = 0;
    for (const auto& Node : ResourceNodes) {
        if (Node.Type == Type && !Node.bIsDepleted) Count++;
    }
    return Count;
}

int AIBlackboard::GetTotalDepletedNodeCount() const {
    int Count = 0;
    for (const auto& Node : ResourceNodes) {
        if (Node.bIsDepleted) Count++;
    }
    return Count;
}

FResourceNode* AIBlackboard::FindNearestActiveNode(EResourceType Type, const FVector& FromPosition) {
    FResourceNode* Nearest = nullptr;
    float MinDist = FLT_MAX;
    for (auto& Node : ResourceNodes) {
        if (Node.Type == Type && !Node.bIsDepleted) {
            float Dist = FromPosition.DistanceTo(Node.Position);
            if (Dist < MinDist) {
                MinDist = Dist;
                Nearest = &Node;
            }
        }
    }
    return Nearest;
}

void AIBlackboard::MarkNodeDepleted(int NodeId) {
    for (auto& Node : ResourceNodes) {
        if (Node.NodeId == NodeId) {
            Node.bIsDepleted = true;
            Node.RemainingAmount = 0;
            break;
        }
    }
}
