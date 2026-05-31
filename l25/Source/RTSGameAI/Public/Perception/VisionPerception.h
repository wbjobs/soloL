#pragma once
#include "Blackboard/AIBlackboard.h"
#include <vector>
#include <functional>
#include <unordered_map>

struct FPerceptionConfig {
    float VisionRadius = 1500.f;
    float FieldOfView = 360.f;
    float UpdateInterval = 0.5f;
    float LoseSightRadius = 2000.f;
};

enum class EPerceptionEventType { Seen, Lost };

struct FPerceptionEvent {
    EPerceptionEventType Type;
    FUnitInfo TargetUnit;
    float TimeSinceDetection = 0.f;
};

class VisionPerception {
public:
    VisionPerception() = default;

    void Initialize(const FPerceptionConfig& InConfig);
    void Update(float DeltaTime, const FVector& OwnerPosition, const std::vector<FUnitInfo>& CandidateUnits);
    void SetOwnerTeam(int TeamId) { OwnerTeam = TeamId; }

    const std::vector<FUnitInfo>& GetVisibleEnemies() const { return VisibleEnemies; }
    const std::vector<FPerceptionEvent>& GetPendingEvents() const { return PendingEvents; }
    void ClearEvents() { PendingEvents.clear(); }

    bool IsUnitVisible(int UnitId) const;
    float GetDistanceToNearestEnemy(const FVector& FromPosition) const;
    int GetVisibleEnemyCount() const { return static_cast<int>(VisibleEnemies.size()); }

    void SetOnTargetSeenCallback(std::function<void(const FUnitInfo&)> Callback) { OnTargetSeen = std::move(Callback); }
    void SetOnTargetLostCallback(std::function<void(int)> Callback) { OnTargetLost = std::move(Callback); }

private:
    bool IsInVisionCone(const FVector& OwnerPos, const FVector& OwnerForward, const FVector& TargetPos) const;
    bool HasLineOfSight(const FVector& From, const FVector& To) const;

    FPerceptionConfig Config;
    int OwnerTeam = 0;
    FVector LastOwnerPosition;
    FVector OwnerForward;
    std::vector<FUnitInfo> VisibleEnemies;
    std::unordered_map<int, float> KnownTargets;
    std::vector<FPerceptionEvent> PendingEvents;
    float TimeSinceLastUpdate = 0.f;
    std::function<void(const FUnitInfo&)> OnTargetSeen;
    std::function<void(int)> OnTargetLost;
};
