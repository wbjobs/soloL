#pragma once
#include "Blackboard/AIBlackboard.h"
#include <vector>
#include <memory>

class dtNavMesh;
class dtNavMeshQuery;
class rcContext;

struct FNavMeshConfig {
    float CellSize = 0.3f;
    float CellHeight = 0.2f;
    float AgentHeight = 2.0f;
    float AgentRadius = 0.6f;
    float AgentMaxClimb = 0.9f;
    float AgentMaxSlope = 45.0f;
    float RegionMinSize = 8.0f;
    float RegionMergeSize = 20.0f;
    float EdgeMaxLen = 12.0f;
    float EdgeMaxError = 1.3f;
    float DetailSampleDist = 6.0f;
    float DetailSampleMaxError = 1.0f;
    float PartitionType = 0;
};

struct FPathResult {
    std::vector<FVector> PathPoints;
    bool bIsValid = false;
    float TotalLength = 0.f;
    unsigned int PathVersion = 0;
};

struct FDynamicObstacle {
    int ObstacleId = 0;
    FVector Position;
    FVector HalfExtents;
    bool bIsBlocking = true;
};

class NavMeshPathfinding {
public:
    NavMeshPathfinding();
    ~NavMeshPathfinding();

    bool Initialize(const FNavMeshConfig& Config);
    bool BuildNavMesh(const float* Vertices, int NumVerts, const int* Triangles, int NumTris);
    FPathResult FindPath(const FVector& Start, const FVector& End, int MaxPolyCount = 256);
    FVector GetRandomPointAround(const FVector& Center, float Radius);
    FVector ProjectPointToNavMesh(const FVector& Point);
    bool IsPointOnNavMesh(const FVector& Point) const;
    void SetNavMeshBounds(const FVector& Min, const FVector& Max);
    bool IsInitialized() const { return bInitialized; }
    
    void SetDirty(bool bInDirty) { bDirty = bInDirty; }
    bool IsDirty() const { return bDirty; }
    
    void AddDynamicObstacle(const FDynamicObstacle& Obstacle);
    void RemoveDynamicObstacle(int ObstacleId);
    void ClearDynamicObstacles();
    const std::vector<FDynamicObstacle>& GetDynamicObstacles() const { return DynamicObstacles; }
    
    bool RebuildWithDynamicObstacles();
    void StoreBaseGeometry(const float* Vertices, int NumVerts, const int* Triangles, int NumTris);
    
    unsigned int GetNavMeshVersion() const { return NavMeshVersion; }
    bool IsPathValid(unsigned int PathVersion) const { return PathVersion == NavMeshVersion; }
    
    void AddBuildingObstacle(const FBuildingInfo& Building, float Padding = 50.f);
    void RemoveBuildingObstacle(int BuildingId);

private:
    bool bInitialized = false;
    bool bDirty = false;
    FNavMeshConfig NavConfig;
    dtNavMesh* NavMesh = nullptr;
    dtNavMeshQuery* NavQuery = nullptr;
    std::unique_ptr<rcContext> RecastCtx;
    FVector BoundsMin;
    FVector BoundsMax;
    std::vector<FDynamicObstacle> DynamicObstacles;
    int NextObstacleId = 1;
    unsigned int NavMeshVersion = 0;
    std::vector<float> CachedVertices;
    std::vector<int> CachedTriangles;
};
