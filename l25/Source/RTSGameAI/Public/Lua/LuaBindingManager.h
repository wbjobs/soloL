#pragma once
#include <string>
#include <memory>
#include <functional>

struct lua_State;
class AIBlackboard;
class BehaviorTree;
class NavMeshPathfinding;
class VisionPerception;

class LuaBindingManager {
public:
    LuaBindingManager();
    ~LuaBindingManager();
    
    bool Initialize();
    void Shutdown();
    
    bool LoadScript(const std::string& ScriptPath);
    bool ExecuteScript(const std::string& ScriptCode);
    
    void RegisterBlackboard(AIBlackboard* BB);
    void RegisterBehaviorTree(BehaviorTree* BT);
    void RegisterNavMesh(NavMeshPathfinding* NavMesh);
    void RegisterPerception(VisionPerception* Perception);
    
    void RegisterFunction(const std::string& Name, std::function<int(lua_State*)> Func);
    
    lua_State* GetState() const { return L; }
    
    void CallTick(float DeltaTime);
    
private:
    void BindAll();
    void BindBlackboard();
    void BindBehaviorTree();
    void BindNavMesh();
    void BindPerception();
    void BindUtilities();
    
    lua_State* L = nullptr;
    AIBlackboard* Blackboard = nullptr;
    BehaviorTree* BT = nullptr;
    NavMeshPathfinding* NavMesh = nullptr;
    VisionPerception* Perception = nullptr;
};
