#pragma once
#include <unordered_map>
#include <string>
#include <variant>
#include <vector>
#include <any>

struct FVector {
    float X = 0.f, Y = 0.f, Z = 0.f;
    FVector() = default;
    FVector(float InX, float InY, float InZ) : X(InX), Y(InY), Z(InZ) {}
    float DistanceTo(const FVector& Other) const {
        float DX = X - Other.X, DY = Y - Other.Y, DZ = Z - Other.Z;
        return sqrtf(DX*DX + DY*DY + DZ*DZ);
    }
};

enum class EResourceType { Gold, Wood, Food, Stone };

struct FResourceAmount {
    EResourceType Type;
    int Amount = 0;
};

struct FResourceNode {
    int NodeId = 0;
    EResourceType Type = EResourceType::Gold;
    FVector Position;
    int RemainingAmount = 1000;
    int MaxAmount = 1000;
    bool bIsDepleted = false;
    float DepletionRate = 1.0f;
};

struct FUnitInfo {
    int UnitId = 0;
    std::string UnitType;
    FVector Position;
    int Health = 100;
    int MaxHealth = 100;
    bool bIsAlive = true;
};

struct FBuildingInfo {
    int BuildingId = 0;
    std::string BuildingType;
    FVector Position;
    float BuildProgress = 0.f;
    bool bIsComplete = false;
    bool bIsUnderAttack = false;
};

class AIBlackboard {
public:
    void SetValue(const std::string& Key, const std::any& Value) { Data[Key] = Value; }

    template<typename T>
    T GetValue(const std::string& Key, const T& Default = T()) const {
        auto It = Data.find(Key);
        if (It != Data.end()) {
            try { return std::any_cast<T>(It->second); }
            catch (...) { return Default; }
        }
        return Default;
    }

    bool HasValue(const std::string& Key) const { return Data.find(Key) != Data.end(); }
    void RemoveValue(const std::string& Key) { Data.erase(Key); }
    void Clear() { Data.clear(); }

    int GetResource(EResourceType Type) const;
    void ModifyResource(EResourceType Type, int Delta);
    void SetResource(EResourceType Type, int Amount);

    const std::vector<FUnitInfo>& GetOwnedUnits() const { return OwnedUnits; }
    void AddOwnedUnit(const FUnitInfo& Unit) { OwnedUnits.push_back(Unit); }
    void RemoveOwnedUnit(int UnitId);

    const std::vector<FBuildingInfo>& GetOwnedBuildings() const { return OwnedBuildings; }
    void AddOwnedBuilding(const FBuildingInfo& Building) { OwnedBuildings.push_back(Building); }
    void RemoveOwnedBuilding(int BuildingId);

    const std::vector<FUnitInfo>& GetVisibleEnemies() const { return VisibleEnemies; }
    void SetVisibleEnemies(std::vector<FUnitInfo> Enemies) { VisibleEnemies = std::move(Enemies); }
    void ClearVisibleEnemies() { VisibleEnemies.clear(); }

    const FVector& GetBasePosition() const { return BasePosition; }
    void SetBasePosition(const FVector& Pos) { BasePosition = Pos; }

    int GetArmySize() const;
    int GetWorkerCount() const;
    bool IsBaseUnderAttack() const;
    FVector GetNearestEnemyPosition() const;

    const std::vector<FResourceNode>& GetResourceNodes() const { return ResourceNodes; }
    void AddResourceNode(const FResourceNode& Node) { ResourceNodes.push_back(Node); }
    void RemoveDepletedNodes();
    
    bool IsResourceTypeDepleted(EResourceType Type) const;
    bool AreAllResourcesDepleted() const;
    int GetActiveNodeCount(EResourceType Type) const;
    int GetTotalDepletedNodeCount() const;
    FResourceNode* FindNearestActiveNode(EResourceType Type, const FVector& FromPosition);
    void MarkNodeDepleted(int NodeId);
    
    bool IsInDefenseMode() const { return bDefenseMode; }
    void SetDefenseMode(bool bInDefense) { bDefenseMode = bInDefense; }

private:
    std::unordered_map<std::string, std::any> Data;
    std::unordered_map<EResourceType, int> Resources;
    std::vector<FUnitInfo> OwnedUnits;
    std::vector<FBuildingInfo> OwnedBuildings;
    std::vector<FUnitInfo> VisibleEnemies;
    std::vector<FResourceNode> ResourceNodes;
    FVector BasePosition;
    bool bDefenseMode = false;
};
