#include "Perception/VisionPerception.h"
#include <algorithm>
#include <cmath>

void VisionPerception::Initialize(const FPerceptionConfig& InConfig) {
    Config = InConfig;
}

void VisionPerception::Update(float DeltaTime, const FVector& OwnerPosition, const std::vector<FUnitInfo>& CandidateUnits) {
    TimeSinceLastUpdate += DeltaTime;
    if (TimeSinceLastUpdate < Config.UpdateInterval) return;
    TimeSinceLastUpdate = 0.f;

    LastOwnerPosition = OwnerPosition;
    OwnerForward = FVector(1.f, 0.f, 0.f);

    std::vector<FUnitInfo> NewVisible;
    std::unordered_map<int, float> NewKnownTargets;

    for (const auto& Unit : CandidateUnits) {
        if (!Unit.bIsAlive) continue;

        float Distance = OwnerPosition.DistanceTo(Unit.Position);
        bool bInVision = false;

        if (Distance <= Config.VisionRadius) {
            bInVision = IsInVisionCone(OwnerPosition, OwnerForward, Unit.Position);
        }

        if (bInVision) {
            NewVisible.push_back(Unit);
            NewKnownTargets[Unit.UnitId] = 0.f;

            if (KnownTargets.find(Unit.UnitId) == KnownTargets.end()) {
                FPerceptionEvent Event;
                Event.Type = EPerceptionEventType::Seen;
                Event.TargetUnit = Unit;
                Event.TimeSinceDetection = 0.f;
                PendingEvents.push_back(Event);
                if (OnTargetSeen) OnTargetSeen(Unit);
            }
        } else if (Distance <= Config.LoseSightRadius) {
            auto It = KnownTargets.find(Unit.UnitId);
            if (It != KnownTargets.end()) {
                float TimeSinceLost = It->second + Config.UpdateInterval;
                if (TimeSinceLost < 2.0f) {
                    NewKnownTargets[Unit.UnitId] = TimeSinceLost;
                }
            }
        }
    }

    for (const auto& KV : KnownTargets) {
        if (NewKnownTargets.find(KV.first) == NewKnownTargets.end()) {
            bool bStillInList = false;
            for (const auto& V : NewVisible) {
                if (V.UnitId == KV.first) { bStillInList = true; break; }
            }
            if (!bStillInList) {
                FPerceptionEvent Event;
                Event.Type = EPerceptionEventType::Lost;
                Event.TargetUnit.UnitId = KV.first;
                PendingEvents.push_back(Event);
                if (OnTargetLost) OnTargetLost(KV.first);
            }
        }
    }

    VisibleEnemies = std::move(NewVisible);
    KnownTargets = std::move(NewKnownTargets);
}

bool VisionPerception::IsUnitVisible(int UnitId) const {
    for (const auto& U : VisibleEnemies) {
        if (U.UnitId == UnitId) return true;
    }
    return false;
}

float VisionPerception::GetDistanceToNearestEnemy(const FVector& FromPosition) const {
    if (VisibleEnemies.empty()) return FLT_MAX;
    float MinDist = FromPosition.DistanceTo(VisibleEnemies[0].Position);
    for (size_t i = 1; i < VisibleEnemies.size(); ++i) {
        float Dist = FromPosition.DistanceTo(VisibleEnemies[i].Position);
        if (Dist < MinDist) MinDist = Dist;
    }
    return MinDist;
}

bool VisionPerception::IsInVisionCone(const FVector& OwnerPos, const FVector& OwnerFwd, const FVector& TargetPos) const {
    if (Config.FieldOfView >= 360.f) return true;

    FVector ToTarget(TargetPos.X - OwnerPos.X, TargetPos.Y - OwnerPos.Y, TargetPos.Z - OwnerPos.Z);
    float Dist = sqrtf(ToTarget.X*ToTarget.X + ToTarget.Y*ToTarget.Y + ToTarget.Z*ToTarget.Z);
    if (Dist < 0.001f) return true;

    ToTarget.X /= Dist; ToTarget.Y /= Dist; ToTarget.Z /= Dist;
    float Dot = OwnerFwd.X*ToTarget.X + OwnerFwd.Y*ToTarget.Y + OwnerFwd.Z*ToTarget.Z;

    float HalfFOV = Config.FieldOfView * 0.5f * (3.14159265f / 180.f);
    return Dot >= cosf(HalfFOV);
}

bool VisionPerception::HasLineOfSight(const FVector& From, const FVector& To) const {
    return true;
}
