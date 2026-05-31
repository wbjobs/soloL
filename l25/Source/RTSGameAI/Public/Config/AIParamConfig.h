#pragma once
#include <string>
#include <unordered_map>
#include <any>
#include <functional>
#include <vector>
#include "ML/BattleMetricsDB.h"

struct AIBattleParams;

class AIParamConfig {
public:
    AIParamConfig() = default;

    bool LoadFromJSON(const std::string& FilePath);
    bool SaveToJSON(const std::string& FilePath) const;

    template<typename T>
    T GetParam(const std::string& Key, const T& Default = T()) const {
        auto It = Params.find(Key);
        if (It != Params.end()) {
            try { return std::any_cast<T>(It->second); }
            catch (...) { return Default; }
        }
        return Default;
    }

    template<typename T>
    void SetParam(const std::string& Key, const T& Value) {
        Params[Key] = Value;
        MarkDirty(Key);
        NotifyListeners(Key);
    }

    void ApplyBattleParams(const AIBattleParams& BP);
    AIBattleParams ToBattleParams() const;

    void AddListener(const std::string& Key, std::function<void(const std::string&)> Callback);
    void RemoveListener(const std::string& Key);

    bool HasParam(const std::string& Key) const { return Params.find(Key) != Params.end(); }
    std::vector<std::string> GetAllParamNames() const;

    bool IsDirty() const { return bDirty; }
    void ClearDirty() { bDirty = false; }
    const std::vector<std::string>& GetDirtyParams() const { return DirtyParams; }

    void ResetToDefaults();
    void PrintParams() const;

private:
    void MarkDirty(const std::string& Key);
    void NotifyListeners(const std::string& Key);
    void InitDefaults();

    std::unordered_map<std::string, std::any> Params;
    std::unordered_map<std::string, std::function<void(const std::string&)>> Listeners;
    std::vector<std::string> DirtyParams;
    bool bDirty = false;
};
