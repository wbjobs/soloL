#include "Navigation/NavMeshPathfinding.h"
#include "Recast.h"
#include "DetourNavMesh.h"
#include "DetourNavMeshQuery.h"
#include "DetourCommon.h"
#include "RecastAlloc.h"
#include <cmath>
#include <iostream>

NavMeshPathfinding::NavMeshPathfinding() = default;
NavMeshPathfinding::~NavMeshPathfinding() {
    if (NavQuery) { dtFreeNavMeshQuery(NavQuery); NavQuery = nullptr; }
    if (NavMesh) { dtFreeNavMesh(NavMesh); NavMesh = nullptr; }
}

bool NavMeshPathfinding::Initialize(const FNavMeshConfig& Config) {
    NavConfig = Config;
    NavMesh = dtAllocNavMesh();
    if (!NavMesh) return false;
    NavQuery = dtAllocNavMeshQuery();
    if (!NavQuery) return false;
    bInitialized = true;
    return true;
}

void NavMeshPathfinding::StoreBaseGeometry(const float* Vertices, int NumVerts, const int* Triangles, int NumTris) {
    CachedVertices.assign(Vertices, Vertices + NumVerts * 3);
    CachedTriangles.assign(Triangles, Triangles + NumTris);
}

bool NavMeshPathfinding::BuildNavMesh(const float* Vertices, int NumVerts, const int* Triangles, int NumTris) {
    if (!bInitialized) return false;
    
    StoreBaseGeometry(Vertices, NumVerts, Triangles, NumTris);
    
    RecastCtx = std::make_unique<rcContext>();

    rcConfig Cfg;
    memset(&Cfg, 0, sizeof(Cfg));
    Cfg.cs = NavConfig.CellSize;
    Cfg.ch = NavConfig.CellHeight;
    Cfg.walkableHeight = (int)ceilf(NavConfig.AgentHeight / Cfg.ch);
    Cfg.walkableClimb = (int)ceilf(NavConfig.AgentMaxClimb / Cfg.ch);
    Cfg.walkableRadius = (int)ceilf(NavConfig.AgentRadius / Cfg.cs);
    Cfg.walkableSlopeAngle = NavConfig.AgentMaxSlope;
    Cfg.maxEdgeLen = (int)(NavConfig.EdgeMaxLen / Cfg.cs);
    Cfg.maxSimplificationError = NavConfig.EdgeMaxError;
    Cfg.minRegionArea = (int)rcSqr(NavConfig.RegionMinSize);
    Cfg.mergeRegionArea = (int)rcSqr(NavConfig.RegionMergeSize);
    Cfg.maxVertsPerPoly = 6;
    Cfg.detailSampleDist = NavConfig.DetailSampleDist < 0.9f ? 0 : NavConfig.CellSize * NavConfig.DetailSampleDist;
    Cfg.detailSampleMaxError = NavConfig.CellHeight * NavConfig.DetailSampleMaxError;

    rcVcopy(Cfg.bmin, &BoundsMin.X);
    rcVcopy(Cfg.bmax, &BoundsMax.X);
    rcCalcGridSize(Cfg.bmin, Cfg.bmax, Cfg.cs, &Cfg.width, &Cfg.height);

    rcHeightfield* Solid = rcAllocHeightfield();
    if (!Solid) return false;
    if (!rcCreateHeightfield(RecastCtx.get(), *Solid, Cfg.width, Cfg.height, Cfg.bmin, Cfg.bmax, Cfg.cs, Cfg.ch)) return false;

    int NumTrisCount = NumTris / 3;
    unsigned char* TriAreas = new unsigned char[NumTrisCount];
    memset(TriAreas, 0, NumTrisCount * sizeof(unsigned char));
    rcMarkWalkableTriangles(RecastCtx.get(), Cfg.walkableSlopeAngle, Vertices, NumVerts, Triangles, NumTrisCount, TriAreas);
    rcRasterizeTriangles(RecastCtx.get(), Vertices, NumVerts, Triangles, TriAreas, NumTrisCount, *Solid, Cfg.walkableClimb);
    delete[] TriAreas;

    rcFilterLowHangingWalkableStructures(RecastCtx.get(), Cfg.walkableClimb, *Solid);
    rcFilterLedgeSpans(RecastCtx.get(), Cfg.walkableHeight, Cfg.walkableClimb, *Solid);
    rcFilterWalkableLowHeightSpans(RecastCtx.get(), Cfg.walkableHeight, *Solid);

    rcCompactHeightfield* Compact = rcAllocCompactHeightfield();
    if (!Compact) return false;
    if (!rcBuildCompactHeightfield(RecastCtx.get(), Cfg.walkableClimb, Cfg.walkableHeight, *Solid, *Compact)) return false;
    rcFreeHeightfield(Solid);

    if (!rcErodeWalkableArea(RecastCtx.get(), Cfg.walkableRadius, *Compact)) return false;
    if (!rcBuildDistanceField(RecastCtx.get(), *Compact)) return false;
    if (!rcBuildRegions(RecastCtx.get(), *Compact, 0, Cfg.minRegionArea, Cfg.mergeRegionArea)) return false;

    rcContourSet* Contours = rcAllocContourSet();
    if (!Contours) return false;
    if (!rcBuildContours(RecastCtx.get(), *Compact, Cfg.maxSimplificationError, Cfg.maxEdgeLen, *Contours)) return false;

    rcPolyMesh* PolyMesh = rcAllocPolyMesh();
    if (!PolyMesh) return false;
    if (!rcBuildPolyMesh(RecastCtx.get(), *Contours, Cfg.maxVertsPerPoly, *PolyMesh)) return false;

    rcPolyMeshDetail* DetailMesh = rcAllocPolyMeshDetail();
    if (!DetailMesh) return false;
    if (!rcBuildPolyMeshDetail(RecastCtx.get(), *PolyMesh, *Compact, Cfg.detailSampleDist, Cfg.detailSampleMaxError, *DetailMesh)) return false;

    for (int i = 0; i < PolyMesh->npolys; ++i) {
        if (PolyMesh->areas[i] == RC_WALKABLE_AREA) {
            PolyMesh->flags[i] = 1;
        }
    }

    dtNavMeshCreateParams Params;
    memset(&Params, 0, sizeof(Params));
    Params.verts = PolyMesh->verts;
    Params.vertCount = PolyMesh->nverts;
    Params.polys = PolyMesh->polys;
    Params.polyAreas = PolyMesh->areas;
    Params.polyFlags = PolyMesh->flags;
    Params.polyCount = PolyMesh->npolys;
    Params.nvp = PolyMesh->nvp;
    Params.detailMeshes = DetailMesh->meshes;
    Params.detailVerts = DetailMesh->verts;
    Params.detailVertsCount = DetailMesh->nverts;
    Params.detailTris = DetailMesh->tris;
    Params.detailTriCount = DetailMesh->ntris;
    Params.walkableHeight = NavConfig.AgentHeight;
    Params.walkableRadius = NavConfig.AgentRadius;
    Params.walkableClimb = NavConfig.AgentMaxClimb;
    rcVcopy(Params.bmin, PolyMesh->bmin);
    rcVcopy(Params.bmax, PolyMesh->bmax);
    Params.cs = Cfg.cs;
    Params.ch = Cfg.ch;
    Params.buildBvTree = true;

    unsigned char* NavData = nullptr;
    int NavDataSize = 0;
    if (!dtCreateNavMeshData(&Params, &NavData, &NavDataSize)) return false;
    
    if (NavMesh->getTileCount() > 0) {
        const dtMeshTile* Tile = NavMesh->getTile(0);
        if (Tile && Tile->data) {
            NavMesh->removeTile(NavMesh->getTileRef(Tile), nullptr, nullptr);
        }
    }
    
    if (dtStatusFailed(NavMesh->addTile(NavData, NavDataSize, DT_TILE_FREE_DATA, 0, nullptr))) return false;

    NavQuery->init(NavMesh, 2048);
    
    NavMeshVersion++;
    bDirty = false;

    rcFreePolyMesh(PolyMesh);
    rcFreePolyMeshDetail(DetailMesh);
    rcFreeContourSet(Contours);
    rcFreeCompactHeightfield(Compact);

    return true;
}

FPathResult NavMeshPathfinding::FindPath(const FVector& Start, const FVector& End, int MaxPolyCount) {
    FPathResult Result;
    Result.PathVersion = NavMeshVersion;
    if (!bInitialized || !NavQuery) return Result;

    float StartPos[3] = { Start.X, Start.Y, Start.Z };
    float EndPos[3] = { End.X, End.Y, End.Z };

    dtQueryFilter Filter;
    Filter.setIncludeFlags(1);
    Filter.setExcludeFlags(0);

    dtPolyRef StartRef = 0, EndRef = 0;
    float StartNearest[3], EndNearest[3];

    NavQuery->findNearestPoly(StartPos, &BoundsMin.X, &BoundsMax.X, &Filter, &StartRef, StartNearest);
    NavQuery->findNearestPoly(EndPos, &BoundsMin.X, &BoundsMax.X, &Filter, &EndRef, EndNearest);

    if (!StartRef || !EndRef) return Result;

    dtPolyRef* PolyPath = new dtPolyRef[MaxPolyCount];
    int PolyPathCount = 0;
    NavQuery->findPath(StartRef, EndRef, StartNearest, EndNearest, &Filter, PolyPath, &PolyPathCount, MaxPolyCount);

    if (PolyPathCount == 0) { delete[] PolyPath; return Result; }

    float* StraightPath = new float[MaxPolyCount * 3];
    dtPolyRef* StraightPathPolys = new dtPolyRef[MaxPolyCount];
    int StraightPathCount = 0;
    NavQuery->findStraightPath(StartNearest, EndNearest, PolyPath, PolyPathCount, StraightPath, StraightPathPolys, nullptr, &StraightPathCount, MaxPolyCount);

    for (int i = 0; i < StraightPathCount; ++i) {
        Result.PathPoints.push_back(FVector(StraightPath[i*3], StraightPath[i*3+1], StraightPath[i*3+2]));
    }

    Result.bIsValid = StraightPathCount > 0;
    for (size_t i = 1; i < Result.PathPoints.size(); ++i) {
        Result.TotalLength += Result.PathPoints[i-1].DistanceTo(Result.PathPoints[i]);
    }

    delete[] PolyPath;
    delete[] StraightPath;
    delete[] StraightPathPolys;

    return Result;
}

FVector NavMeshPathfinding::GetRandomPointAround(const FVector& Center, float Radius) {
    if (!bInitialized || !NavQuery) return Center;

    float CenterPos[3] = { Center.X, Center.Y, Center.Z };
    dtQueryFilter Filter;
    Filter.setIncludeFlags(1);
    Filter.setExcludeFlags(0);

    dtPolyRef Ref = 0;
    float Nearest[3];
    NavQuery->findNearestPoly(CenterPos, &BoundsMin.X, &BoundsMax.X, &Filter, &Ref, Nearest);
    if (!Ref) return Center;

    dtPolyRef RandomRef = 0;
    float RandomPt[3];
    NavQuery->findRandomPointAroundCircle(Ref, Nearest, Radius, &Filter,
        []() -> float { return (float)rand() / (float)RAND_MAX; },
        &RandomRef, RandomPt);

    return FVector(RandomPt[0], RandomPt[1], RandomPt[2]);
}

FVector NavMeshPathfinding::ProjectPointToNavMesh(const FVector& Point) {
    if (!bInitialized || !NavQuery) return Point;
    float Pos[3] = { Point.X, Point.Y, Point.Z };
    dtQueryFilter Filter;
    Filter.setIncludeFlags(1);
    Filter.setExcludeFlags(0);
    dtPolyRef Ref = 0;
    float Nearest[3];
    NavQuery->findNearestPoly(Pos, &BoundsMin.X, &BoundsMax.X, &Filter, &Ref, Nearest);
    return Ref ? FVector(Nearest[0], Nearest[1], Nearest[2]) : Point;
}

bool NavMeshPathfinding::IsPointOnNavMesh(const FVector& Point) const {
    if (!bInitialized || !NavQuery) return false;
    float Pos[3] = { Point.X, Point.Y, Point.Z };
    dtQueryFilter Filter;
    Filter.setIncludeFlags(1);
    Filter.setExcludeFlags(0);
    dtPolyRef Ref = 0;
    float Nearest[3];
    const_cast<dtNavMeshQuery*>(NavQuery)->findNearestPoly(Pos, &BoundsMin.X, &BoundsMax.X, &Filter, &Ref, Nearest);
    return Ref != 0;
}

void NavMeshPathfinding::SetNavMeshBounds(const FVector& Min, const FVector& Max) {
    BoundsMin = Min;
    BoundsMax = Max;
}

void NavMeshPathfinding::AddDynamicObstacle(const FDynamicObstacle& Obstacle) {
    DynamicObstacles.push_back(Obstacle);
    bDirty = true;
}

void NavMeshPathfinding::RemoveDynamicObstacle(int ObstacleId) {
    DynamicObstacles.erase(
        std::remove_if(DynamicObstacles.begin(), DynamicObstacles.end(),
            [ObstacleId](const FDynamicObstacle& O) { return O.ObstacleId == ObstacleId; }),
        DynamicObstacles.end());
    bDirty = true;
}

void NavMeshPathfinding::ClearDynamicObstacles() {
    DynamicObstacles.clear();
    bDirty = true;
}

bool NavMeshPathfinding::RebuildWithDynamicObstacles() {
    if (CachedVertices.empty() || CachedTriangles.empty()) {
        std::cerr << "[NavMesh] No cached geometry available for rebuild" << std::endl;
        return false;
    }
    
    std::vector<float> CombinedVerts(CachedVertices);
    std::vector<int> CombinedTris(CachedTriangles);
    int BaseVertIndex = static_cast<int>(CachedVertices.size()) / 3;
    
    for (const auto& Obstacle : DynamicObstacles) {
        if (!Obstacle.bIsBlocking) continue;
        
        float MinX = Obstacle.Position.X - Obstacle.HalfExtents.X;
        float MaxX = Obstacle.Position.X + Obstacle.HalfExtents.X;
        float MinY = Obstacle.Position.Y - Obstacle.HalfExtents.Y;
        float MaxY = Obstacle.Position.Y + Obstacle.HalfExtents.Y;
        float MinZ = Obstacle.Position.Z - Obstacle.HalfExtents.Z;
        float MaxZ = Obstacle.Position.Z + Obstacle.HalfExtents.Z;
        
        float ObsVerts[] = {
            MinX, MinY, MinZ,
            MaxX, MinY, MinZ,
            MaxX, MaxY, MinZ,
            MinX, MaxY, MinZ,
            MinX, MinY, MaxZ,
            MaxX, MinY, MaxZ,
            MaxX, MaxY, MaxZ,
            MinX, MaxY, MaxZ
        };
        
        for (int i = 0; i < 24; ++i) {
            CombinedVerts.push_back(ObsVerts[i]);
        }
        
        int Tris[] = {
            0,1,2, 0,2,3,
            4,6,5, 4,7,6,
            0,5,1, 0,4,5,
            2,6,7, 2,7,3,
            0,3,7, 0,7,4,
            1,5,6, 1,6,2
        };
        
        for (int i = 0; i < 36; ++i) {
            CombinedTris.push_back(Tris[i] + BaseVertIndex);
        }
        
        BaseVertIndex += 8;
    }
    
    std::cout << "[NavMesh] Rebuilding with " << DynamicObstacles.size() 
              << " dynamic obstacles (" << CombinedVerts.size()/3 << " verts, " 
              << CombinedTris.size()/3 << " tris)" << std::endl;
    
    bool bSuccess = BuildNavMesh(CombinedVerts.data(), static_cast<int>(CombinedVerts.size()) / 3,
                                  CombinedTris.data(), static_cast<int>(CombinedTris.size()));
    
    if (bSuccess) {
        bDirty = false;
        std::cout << "[NavMesh] Rebuild complete. Version: " << NavMeshVersion << std::endl;
    }
    
    return bSuccess;
}

void NavMeshPathfinding::AddBuildingObstacle(const FBuildingInfo& Building, float Padding) {
    FDynamicObstacle Obstacle;
    Obstacle.ObstacleId = Building.BuildingId + 10000;
    Obstacle.Position = Building.Position;
    
    float DefaultExtent = 150.f;
    Obstacle.HalfExtents = FVector(DefaultExtent + Padding, DefaultExtent + Padding, 200.f);
    Obstacle.bIsBlocking = true;
    
    bool bExists = false;
    for (const auto& Existing : DynamicObstacles) {
        if (Existing.ObstacleId == Obstacle.ObstacleId) {
            bExists = true;
            break;
        }
    }
    
    if (!bExists) {
        AddDynamicObstacle(Obstacle);
    }
}

void NavMeshPathfinding::RemoveBuildingObstacle(int BuildingId) {
    RemoveDynamicObstacle(BuildingId + 10000);
}
