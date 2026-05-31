#include "ML/BattleMetricsDB.h"
#include <sqlite3.h>
#include <iostream>
#include <sstream>
#include <chrono>
#include <cmath>
#include <fstream>

BattleMetricsDB::BattleMetricsDB() = default;

BattleMetricsDB::~BattleMetricsDB() {
    Close();
}

bool BattleMetricsDB::Open(const std::string& DBPath) {
    if (DB) Close();
    int Result = sqlite3_open(DBPath.c_str(), &DB);
    if (Result != SQLITE_OK) {
        std::cerr << "[BattleMetricsDB] Cannot open DB: " << sqlite3_errmsg(DB) << std::endl;
        return false;
    }
    return InitSchema();
}

void BattleMetricsDB::Close() {
    if (DB) {
        sqlite3_close(DB);
        DB = nullptr;
    }
}

bool BattleMetricsDB::InitSchema() {
    const char* Schema = R"(
        CREATE TABLE IF NOT EXISTS battles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            map_name TEXT,
            ai_name TEXT,
            enemy_name TEXT,
            victory INTEGER NOT NULL,
            duration INTEGER,
            ai_final_units INTEGER,
            enemy_final_units INTEGER,
            resources_gathered REAL,
            resources_spent REAL,
            attack_army_threshold REAL,
            defense_army_threshold REAL,
            reserve_ratio REAL,
            worker_soldier_ratio REAL,
            build_priority REAL,
            gather_priority REAL,
            aggression REAL,
            expansion_rate REAL,
            retreat_threshold REAL,
            vision_multiplier REAL,
            version INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_battles_victory ON battles(victory);
        CREATE INDEX IF NOT EXISTS idx_battles_timestamp ON battles(timestamp);
        CREATE INDEX IF NOT EXISTS idx_battles_aggression ON battles(aggression);
    )";
    char* ErrMsg = nullptr;
    int Result = sqlite3_exec(DB, Schema, nullptr, nullptr, &ErrMsg);
    if (Result != SQLITE_OK) {
        std::cerr << "[BattleMetricsDB] Schema error: " << ErrMsg << std::endl;
        sqlite3_free(ErrMsg);
        return false;
    }
    return true;
}

bool BattleMetricsDB::BindParams(sqlite3_stmt* Stmt, const BattleRecord& Record) {
    int Idx = 1;
    sqlite3_bind_int64(Stmt, Idx++, Record.Timestamp);
    sqlite3_bind_text(Stmt, Idx++, Record.MapName.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(Stmt, Idx++, Record.AIName.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(Stmt, Idx++, Record.EnemyName.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(Stmt, Idx++, Record.bVictory ? 1 : 0);
    sqlite3_bind_int(Stmt, Idx++, Record.BattleDurationSeconds);
    sqlite3_bind_int(Stmt, Idx++, Record.AIFinalUnits);
    sqlite3_bind_int(Stmt, Idx++, Record.EnemyFinalUnits);
    sqlite3_bind_double(Stmt, Idx++, Record.ResourcesGatheredTotal);
    sqlite3_bind_double(Stmt, Idx++, Record.ResourcesSpentTotal);
    sqlite3_bind_double(Stmt, Idx++, Record.Params.AttackArmyThreshold);
    sqlite3_bind_double(Stmt, Idx++, Record.Params.DefenseArmyThreshold);
    sqlite3_bind_double(Stmt, Idx++, Record.Params.ResourceReserveRatio);
    sqlite3_bind_double(Stmt, Idx++, Record.Params.WorkerToSoldierRatio);
    sqlite3_bind_double(Stmt, Idx++, Record.Params.BuildPriorityWeight);
    sqlite3_bind_double(Stmt, Idx++, Record.Params.GatherPriorityWeight);
    sqlite3_bind_double(Stmt, Idx++, Record.Params.AggressionLevel);
    sqlite3_bind_double(Stmt, Idx++, Record.Params.ExpansionRate);
    sqlite3_bind_double(Stmt, Idx++, Record.Params.RetreatHealthThreshold);
    sqlite3_bind_double(Stmt, Idx++, Record.Params.VisionRadiusMultiplier);
    sqlite3_bind_int(Stmt, Idx++, Record.Version);
    return true;
}

AIBattleParams BattleMetricsDB::ExtractParamsFromRow(sqlite3_stmt* Stmt, int StartCol) {
    AIBattleParams Params;
    int Col = StartCol;
    Params.AttackArmyThreshold = static_cast<float>(sqlite3_column_double(Stmt, Col++));
    Params.DefenseArmyThreshold = static_cast<float>(sqlite3_column_double(Stmt, Col++));
    Params.ResourceReserveRatio = static_cast<float>(sqlite3_column_double(Stmt, Col++));
    Params.WorkerToSoldierRatio = static_cast<float>(sqlite3_column_double(Stmt, Col++));
    Params.BuildPriorityWeight = static_cast<float>(sqlite3_column_double(Stmt, Col++));
    Params.GatherPriorityWeight = static_cast<float>(sqlite3_column_double(Stmt, Col++));
    Params.AggressionLevel = static_cast<float>(sqlite3_column_double(Stmt, Col++));
    Params.ExpansionRate = static_cast<float>(sqlite3_column_double(Stmt, Col++));
    Params.RetreatHealthThreshold = static_cast<float>(sqlite3_column_double(Stmt, Col++));
    Params.VisionRadiusMultiplier = static_cast<float>(sqlite3_column_double(Stmt, Col++));
    return Params;
}

bool BattleMetricsDB::InsertBattleRecord(const BattleRecord& Record) {
    if (!DB) return false;
    const char* SQL = R"(
        INSERT INTO battles (timestamp, map_name, ai_name, enemy_name, victory, duration,
            ai_final_units, enemy_final_units, resources_gathered, resources_spent,
            attack_army_threshold, defense_army_threshold, reserve_ratio, worker_soldier_ratio,
            build_priority, gather_priority, aggression, expansion_rate, retreat_threshold,
            vision_multiplier, version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    )";
    sqlite3_stmt* Stmt = nullptr;
    if (sqlite3_prepare_v2(DB, SQL, -1, &Stmt, nullptr) != SQLITE_OK) return false;
    BindParams(Stmt, Record);
    bool Success = sqlite3_step(Stmt) == SQLITE_DONE;
    sqlite3_finalize(Stmt);
    return Success;
}

std::vector<BattleRecord> BattleMetricsDB::GetAllBattleRecords(int Limit) {
    std::vector<BattleRecord> Records;
    if (!DB) return Records;
    std::stringstream SS;
    SS << "SELECT id, timestamp, map_name, ai_name, enemy_name, victory, duration, "
       << "ai_final_units, enemy_final_units, resources_gathered, resources_spent, "
       << "attack_army_threshold, defense_army_threshold, reserve_ratio, worker_soldier_ratio, "
       << "build_priority, gather_priority, aggression, expansion_rate, retreat_threshold, "
       << "vision_multiplier, version FROM battles ORDER BY timestamp DESC LIMIT " << Limit;
    sqlite3_stmt* Stmt = nullptr;
    if (sqlite3_prepare_v2(DB, SS.str().c_str(), -1, &Stmt, nullptr) != SQLITE_OK) return Records;
    while (sqlite3_step(Stmt) == SQLITE_ROW) {
        BattleRecord R;
        int Col = 0;
        R.BattleId = sqlite3_column_int64(Stmt, Col++);
        R.Timestamp = sqlite3_column_int64(Stmt, Col++);
        const char* Map = reinterpret_cast<const char*>(sqlite3_column_text(Stmt, Col++));
        if (Map) R.MapName = Map;
        const char* AIN = reinterpret_cast<const char*>(sqlite3_column_text(Stmt, Col++));
        if (AIN) R.AIName = AIN;
        const char* EN = reinterpret_cast<const char*>(sqlite3_column_text(Stmt, Col++));
        if (EN) R.EnemyName = EN;
        R.bVictory = sqlite3_column_int(Stmt, Col++) != 0;
        R.BattleDurationSeconds = sqlite3_column_int(Stmt, Col++);
        R.AIFinalUnits = sqlite3_column_int(Stmt, Col++);
        R.EnemyFinalUnits = sqlite3_column_int(Stmt, Col++);
        R.ResourcesGatheredTotal = static_cast<float>(sqlite3_column_double(Stmt, Col++));
        R.ResourcesSpentTotal = static_cast<float>(sqlite3_column_double(Stmt, Col++));
        R.Params = ExtractParamsFromRow(Stmt, Col);
        Col += 10;
        R.Version = sqlite3_column_int(Stmt, Col++);
        Records.push_back(R);
    }
    sqlite3_finalize(Stmt);
    return Records;
}

std::vector<BattleRecord> BattleMetricsDB::GetVictoryRecords(int Limit) {
    std::vector<BattleRecord> Records;
    if (!DB) return Records;
    std::stringstream SS;
    SS << "SELECT id, timestamp, map_name, ai_name, enemy_name, victory, duration, "
       << "ai_final_units, enemy_final_units, resources_gathered, resources_spent, "
       << "attack_army_threshold, defense_army_threshold, reserve_ratio, worker_soldier_ratio, "
       << "build_priority, gather_priority, aggression, expansion_rate, retreat_threshold, "
       << "vision_multiplier, version FROM battles WHERE victory = 1 "
       << "ORDER BY timestamp DESC LIMIT " << Limit;
    sqlite3_stmt* Stmt = nullptr;
    if (sqlite3_prepare_v2(DB, SS.str().c_str(), -1, &Stmt, nullptr) != SQLITE_OK) return Records;
    while (sqlite3_step(Stmt) == SQLITE_ROW) {
        BattleRecord R;
        int Col = 0;
        R.BattleId = sqlite3_column_int64(Stmt, Col++);
        R.Timestamp = sqlite3_column_int64(Stmt, Col++);
        const char* Map = reinterpret_cast<const char*>(sqlite3_column_text(Stmt, Col++));
        if (Map) R.MapName = Map;
        const char* AIN = reinterpret_cast<const char*>(sqlite3_column_text(Stmt, Col++));
        if (AIN) R.AIName = AIN;
        const char* EN = reinterpret_cast<const char*>(sqlite3_column_text(Stmt, Col++));
        if (EN) R.EnemyName = EN;
        R.bVictory = sqlite3_column_int(Stmt, Col++) != 0;
        R.BattleDurationSeconds = sqlite3_column_int(Stmt, Col++);
        R.AIFinalUnits = sqlite3_column_int(Stmt, Col++);
        R.EnemyFinalUnits = sqlite3_column_int(Stmt, Col++);
        R.ResourcesGatheredTotal = static_cast<float>(sqlite3_column_double(Stmt, Col++));
        R.ResourcesSpentTotal = static_cast<float>(sqlite3_column_double(Stmt, Col++));
        R.Params = ExtractParamsFromRow(Stmt, Col);
        Col += 10;
        R.Version = sqlite3_column_int(Stmt, Col++);
        Records.push_back(R);
    }
    sqlite3_finalize(Stmt);
    return Records;
}

float BattleMetricsDB::CalculateWinRate() {
    if (!DB) return 0.f;
    const char* SQL = "SELECT COUNT(*), SUM(victory) FROM battles";
    sqlite3_stmt* Stmt = nullptr;
    if (sqlite3_prepare_v2(DB, SQL, -1, &Stmt, nullptr) != SQLITE_OK) return 0.f;
    float Rate = 0.f;
    if (sqlite3_step(Stmt) == SQLITE_ROW) {
        int Total = sqlite3_column_int(Stmt, 0);
        int Wins = sqlite3_column_int(Stmt, 1);
        Rate = Total > 0 ? static_cast<float>(Wins) / Total : 0.f;
    }
    sqlite3_finalize(Stmt);
    return Rate;
}

int BattleMetricsDB::GetTotalBattleCount() {
    if (!DB) return 0;
    const char* SQL = "SELECT COUNT(*) FROM battles";
    sqlite3_stmt* Stmt = nullptr;
    if (sqlite3_prepare_v2(DB, SQL, -1, &Stmt, nullptr) != SQLITE_OK) return 0;
    int Count = 0;
    if (sqlite3_step(Stmt) == SQLITE_ROW) Count = sqlite3_column_int(Stmt, 0);
    sqlite3_finalize(Stmt);
    return Count;
}

int BattleMetricsDB::GetVictoryCount() {
    if (!DB) return 0;
    const char* SQL = "SELECT COUNT(*) FROM battles WHERE victory = 1";
    sqlite3_stmt* Stmt = nullptr;
    if (sqlite3_prepare_v2(DB, SQL, -1, &Stmt, nullptr) != SQLITE_OK) return 0;
    int Count = 0;
    if (sqlite3_step(Stmt) == SQLITE_ROW) Count = sqlite3_column_int(Stmt, 0);
    sqlite3_finalize(Stmt);
    return Count;
}

int BattleMetricsDB::GetDefeatCount() {
    return GetTotalBattleCount() - GetVictoryCount();
}

AIBattleParams BattleMetricsDB::GetOptimizedParams(float WinRateThreshold) {
    AIBattleParams Optimal;
    if (!DB) return Optimal;
    auto Victories = GetVictoryRecords(100);
    if (Victories.empty()) return Optimal;
    int Count = 0;
    for (const auto& R : Victories) {
        Optimal.AttackArmyThreshold += R.Params.AttackArmyThreshold;
        Optimal.DefenseArmyThreshold += R.Params.DefenseArmyThreshold;
        Optimal.ResourceReserveRatio += R.Params.ResourceReserveRatio;
        Optimal.WorkerToSoldierRatio += R.Params.WorkerToSoldierRatio;
        Optimal.BuildPriorityWeight += R.Params.BuildPriorityWeight;
        Optimal.GatherPriorityWeight += R.Params.GatherPriorityWeight;
        Optimal.AggressionLevel += R.Params.AggressionLevel;
        Optimal.ExpansionRate += R.Params.ExpansionRate;
        Optimal.RetreatHealthThreshold += R.Params.RetreatHealthThreshold;
        Optimal.VisionRadiusMultiplier += R.Params.VisionRadiusMultiplier;
        Count++;
    }
    if (Count > 0) {
        Optimal.AttackArmyThreshold /= Count;
        Optimal.DefenseArmyThreshold /= Count;
        Optimal.ResourceReserveRatio /= Count;
        Optimal.WorkerToSoldierRatio /= Count;
        Optimal.BuildPriorityWeight /= Count;
        Optimal.GatherPriorityWeight /= Count;
        Optimal.AggressionLevel /= Count;
        Optimal.ExpansionRate /= Count;
        Optimal.RetreatHealthThreshold /= Count;
        Optimal.VisionRadiusMultiplier /= Count;
    }
    return Optimal;
}

std::vector<BattleRecord> BattleMetricsDB::GetRecordsByParamRange(const std::string& ParamName, float MinVal, float MaxVal) {
    return GetAllBattleRecords(100);
}

float BattleMetricsDB::CalculateWinRateForParam(const std::string& ParamName, float Value, float Tolerance) {
    return 0.5f;
}

std::vector<ParamStats> BattleMetricsDB::GetTopPerformingParams(int TopN) {
    return {};
}

bool BattleMetricsDB::ExportToJSON(const std::string& FilePath) {
    auto Records = GetAllBattleRecords(1000);
    std::ofstream Out(FilePath);
    if (!Out) return false;
    Out << "[\n";
    for (size_t i = 0; i < Records.size(); ++i) {
        const auto& R = Records[i];
        Out << "  {\n";
        Out << "    \"id\": " << R.BattleId << ",\n";
        Out << "    \"victory\": " << (R.bVictory ? "true" : "false") << ",\n";
        Out << "    \"params\": {\n";
        Out << "      \"attack_army_threshold\": " << R.Params.AttackArmyThreshold << ",\n";
        Out << "      \"defense_army_threshold\": " << R.Params.DefenseArmyThreshold << ",\n";
        Out << "      \"reserve_ratio\": " << R.Params.ResourceReserveRatio << ",\n";
        Out << "      \"aggression\": " << R.Params.AggressionLevel << "\n";
        Out << "    }\n";
        Out << "  }" << (i < Records.size() - 1 ? "," : "") << "\n";
    }
    Out << "]\n";
    return true;
}

bool BattleMetricsDB::ImportFromJSON(const std::string& FilePath) {
    return false;
}

void BattleMetricsDB::ClearOldRecords(int DaysToKeep) {
    if (!DB) return;
    auto Now = std::chrono::system_clock::now().time_since_epoch();
    int64_t Cutoff = std::chrono::duration_cast<std::chrono::seconds>(Now).count() - DaysToKeep * 86400;
    std::stringstream SS;
    SS << "DELETE FROM battles WHERE timestamp < " << Cutoff;
    sqlite3_exec(DB, SS.str().c_str(), nullptr, nullptr, nullptr);
}
