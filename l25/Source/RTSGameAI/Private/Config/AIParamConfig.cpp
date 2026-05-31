#include "Config/AIParamConfig.h"
#include <fstream>
#include <sstream>
#include <iostream>
#include "../../ThirdParty/nlohmann/json.hpp"

using json = nlohmann::json;

void AIParamConfig::InitDefaults() {
    SetParam("AttackArmyThreshold", 5.0f);
    SetParam("DefenseArmyThreshold", 3.0f);
    SetParam("ResourceReserveRatio", 0.3f);
    SetParam("WorkerToSoldierRatio", 2.0f);
    SetParam("BuildPriorityWeight", 1.0f);
    SetParam("GatherPriorityWeight", 1.0f);
    SetParam("AggressionLevel", 0.5f);
    SetParam("ExpansionRate", 0.5f);
    SetParam("RetreatHealthThreshold", 0.3f);
    SetParam("VisionRadiusMultiplier", 1.0f);
    SetParam("GatherInterval", 2.0f);
    SetParam("ProductionInterval", 3.0f);
    SetParam("BuildInterval", 5.0f);
    bDirty = false;
    DirtyParams.clear();
}

void AIParamConfig::MarkDirty(const std::string& Key) {
    bDirty = true;
    for (const auto& K : DirtyParams) {
        if (K == Key) return;
    }
    DirtyParams.push_back(Key);
}

void AIParamConfig::NotifyListeners(const std::string& Key) {
    auto It = Listeners.find(Key);
    if (It != Listeners.end() && It->second) {
        It->second(Key);
    }
}

bool AIParamConfig::LoadFromJSON(const std::string& FilePath) {
    std::ifstream In(FilePath);
    if (!In.is_open()) {
        InitDefaults();
        return false;
    }
    try {
        json J;
        In >> J;
        Params.clear();
        for (json::iterator It = J.begin(); It != J.end(); ++It) {
            if (It.value().is_number_float()) {
                Params[It.key()] = static_cast<float>(It.value());
            } else if (It.value().is_number_integer()) {
                Params[It.key()] = static_cast<int>(It.value());
            } else if (It.value().is_boolean()) {
                Params[It.key()] = static_cast<bool>(It.value());
            } else if (It.value().is_string()) {
                Params[It.key()] = It.value().get<std::string>();
            }
        }
        bDirty = false;
        DirtyParams.clear();
        return true;
    } catch (...) {
        InitDefaults();
        return false;
    }
}

bool AIParamConfig::SaveToJSON(const std::string& FilePath) const {
    json J;
    for (const auto& Pair : Params) {
        try {
            if (Pair.second.type() == typeid(float)) {
                J[Pair.first] = std::any_cast<float>(Pair.second);
            } else if (Pair.second.type() == typeid(int)) {
                J[Pair.first] = std::any_cast<int>(Pair.second);
            } else if (Pair.second.type() == typeid(bool)) {
                J[Pair.first] = std::any_cast<bool>(Pair.second);
            } else if (Pair.second.type() == typeid(std::string)) {
                J[Pair.first] = std::any_cast<std::string>(Pair.second);
            }
        } catch (...) {}
    }
    std::ofstream Out(FilePath);
    if (!Out.is_open()) return false;
    Out << J.dump(2);
    return true;
}

void AIParamConfig::ApplyBattleParams(const AIBattleParams& BP) {
    SetParam("AttackArmyThreshold", BP.AttackArmyThreshold);
    SetParam("DefenseArmyThreshold", BP.DefenseArmyThreshold);
    SetParam("ResourceReserveRatio", BP.ResourceReserveRatio);
    SetParam("WorkerToSoldierRatio", BP.WorkerToSoldierRatio);
    SetParam("BuildPriorityWeight", BP.BuildPriorityWeight);
    SetParam("GatherPriorityWeight", BP.GatherPriorityWeight);
    SetParam("AggressionLevel", BP.AggressionLevel);
    SetParam("ExpansionRate", BP.ExpansionRate);
    SetParam("RetreatHealthThreshold", BP.RetreatHealthThreshold);
    SetParam("VisionRadiusMultiplier", BP.VisionRadiusMultiplier);
}

AIBattleParams AIParamConfig::ToBattleParams() const {
    AIBattleParams BP;
    BP.AttackArmyThreshold = GetParam("AttackArmyThreshold", 5.0f);
    BP.DefenseArmyThreshold = GetParam("DefenseArmyThreshold", 3.0f);
    BP.ResourceReserveRatio = GetParam("ResourceReserveRatio", 0.3f);
    BP.WorkerToSoldierRatio = GetParam("WorkerToSoldierRatio", 2.0f);
    BP.BuildPriorityWeight = GetParam("BuildPriorityWeight", 1.0f);
    BP.GatherPriorityWeight = GetParam("GatherPriorityWeight", 1.0f);
    BP.AggressionLevel = GetParam("AggressionLevel", 0.5f);
    BP.ExpansionRate = GetParam("ExpansionRate", 0.5f);
    BP.RetreatHealthThreshold = GetParam("RetreatHealthThreshold", 0.3f);
    BP.VisionRadiusMultiplier = GetParam("VisionRadiusMultiplier", 1.0f);
    return BP;
}

void AIParamConfig::AddListener(const std::string& Key, std::function<void(const std::string&)> Callback) {
    Listeners[Key] = std::move(Callback);
}

void AIParamConfig::RemoveListener(const std::string& Key) {
    Listeners.erase(Key);
}

std::vector<std::string> AIParamConfig::GetAllParamNames() const {
    std::vector<std::string> Names;
    for (const auto& P : Params) Names.push_back(P.first);
    return Names;
}

void AIParamConfig::ResetToDefaults() {
    InitDefaults();
}

void AIParamConfig::PrintParams() const {
    std::cout << "=== AI Parameters ===" << std::endl;
    for (const auto& P : Params) {
        std::cout << "  " << P.first << ": ";
        try {
            if (P.second.type() == typeid(float)) {
                std::cout << std::any_cast<float>(P.second);
            } else if (P.second.type() == typeid(int)) {
                std::cout << std::any_cast<int>(P.second);
            } else if (P.second.type() == typeid(bool)) {
                std::cout << (std::any_cast<bool>(P.second) ? "true" : "false");
            } else if (P.second.type() == typeid(std::string)) {
                std::cout << std::any_cast<std::string>(P.second);
            }
        } catch (...) {
            std::cout << "?";
        }
        std::cout << std::endl;
    }
}
