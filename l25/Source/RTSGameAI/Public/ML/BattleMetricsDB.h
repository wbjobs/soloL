#pragma once
#include <string>
#include <vector>
#include <memory>
#include <unordered_map>

struct sqlite3;
struct sqlite3_stmt;

struct AIBattleParams {
    float AttackArmyThreshold = 5.0f;
    float DefenseArmyThreshold = 3.0f;
    float ResourceReserveRatio = 0.3f;
    float WorkerToSoldierRatio = 2.0f;
    float BuildPriorityWeight = 1.0f;
    float GatherPriorityWeight = 1.0f;
    float AggressionLevel = 0.5f;
    float ExpansionRate = 0.5f;
    float RetreatHealthThreshold = 0.3f;
    float VisionRadiusMultiplier = 1.0f;
};

struct BattleRecord {
    int64_t BattleId = 0;
    int64_t Timestamp = 0;
    std::string MapName;
    std::string AIName;
    std::string EnemyName;
    bool bVictory = false;
    int BattleDurationSeconds = 0;
    int AIFinalUnits = 0;
    int EnemyFinalUnits = 0;
    float ResourcesGatheredTotal = 0;
    float ResourcesSpentTotal = 0;
    AIBattleParams Params;
    int Version = 1;
};

struct ParamStats {
    std::string ParamName;
    float MeanValue = 0.f;
    float WinRate = 0.f;
    int SampleCount = 0;
};

class BattleMetricsDB {
public:
    BattleMetricsDB();
    ~BattleMetricsDB();

    bool Open(const std::string& DBPath);
    void Close();
    bool IsOpen() const { return DB != nullptr; }

    bool InsertBattleRecord(const BattleRecord& Record);
    std::vector<BattleRecord> GetAllBattleRecords(int Limit = 1000);
    std::vector<BattleRecord> GetVictoryRecords(int Limit = 500);
    std::vector<BattleRecord> GetRecordsByParamRange(const std::string& ParamName, float MinVal, float MaxVal);

    float CalculateWinRate();
    float CalculateWinRateForParam(const std::string& ParamName, float Value, float Tolerance = 0.1f);
    std::vector<ParamStats> GetTopPerformingParams(int TopN = 10);

    AIBattleParams GetOptimizedParams(float WinRateThreshold = 0.6f);
    int GetTotalBattleCount();
    int GetVictoryCount();
    int GetDefeatCount();

    bool ExportToJSON(const std::string& FilePath);
    bool ImportFromJSON(const std::string& FilePath);

    void ClearOldRecords(int DaysToKeep = 30);

private:
    bool InitSchema();
    bool BindParams(sqlite3_stmt* Stmt, const BattleRecord& Record);
    AIBattleParams ExtractParamsFromRow(sqlite3_stmt* Stmt, int StartCol);

    sqlite3* DB = nullptr;
    std::unordered_map<std::string, int> ParamColumnMap;
};
