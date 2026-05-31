#include "Lua/LuaBindingManager.h"
#include "Blackboard/AIBlackboard.h"
#include "BT/BehaviorTree.h"
#include "BT/BTSelector.h"
#include "BT/BTSequence.h"
#include "BT/BTCondition.h"
#include "BT/BTAction.h"
#include "BT/BTDecorator.h"
#include "Navigation/NavMeshPathfinding.h"
#include "Perception/VisionPerception.h"
#include "Actions/BTAction_BuildBase.h"
#include "Actions/BTAction_GatherResource.h"
#include "Actions/BTAction_ProduceUnit.h"
#include "Actions/BTAction_Attack.h"
#include "Actions/BTAction_Retreat.h"
#include "Conditions/BTCond_HasResources.h"
#include "Conditions/BTCond_EnemyInSight.h"
#include "Conditions/BTCond_BaseUnderAttack.h"
#include "Conditions/BTCond_ArmyReady.h"
#include "Decorators/BTDecorator_Cooldown.h"
#include "Decorators/BTDecorator_Inverter.h"
#include "Decorators/BTDecorator_Repeat.h"
#include <lua.hpp>
#include <iostream>

template<typename T>
T** GetLuaUserData(lua_State* L, int Index, const char* MetaName) {
    void* Ptr = luaL_checkudata(L, Index, MetaName);
    luaL_argcheck(L, Ptr != nullptr, Index, "Expected userdata");
    return static_cast<T**>(Ptr);
}

LuaBindingManager::LuaBindingManager() = default;

LuaBindingManager::~LuaBindingManager() {
    Shutdown();
}

bool LuaBindingManager::Initialize() {
    L = luaL_newstate();
    if (!L) return false;
    luaL_openlibs(L);
    BindAll();
    return true;
}

void LuaBindingManager::Shutdown() {
    if (L) {
        lua_close(L);
        L = nullptr;
    }
}

bool LuaBindingManager::LoadScript(const std::string& ScriptPath) {
    if (!L) return false;
    int Result = luaL_dofile(L, ScriptPath.c_str());
    if (Result != LUA_OK) {
        std::cerr << "Lua Error: " << lua_tostring(L, -1) << std::endl;
        lua_pop(L, 1);
        return false;
    }
    return true;
}

bool LuaBindingManager::ExecuteScript(const std::string& ScriptCode) {
    if (!L) return false;
    int Result = luaL_dostring(L, ScriptCode.c_str());
    if (Result != LUA_OK) {
        std::cerr << "Lua Error: " << lua_tostring(L, -1) << std::endl;
        lua_pop(L, 1);
        return false;
    }
    return true;
}

void LuaBindingManager::RegisterBlackboard(AIBlackboard* BB) {
    Blackboard = BB;
    if (L) {
        lua_pushlightuserdata(L, BB);
        lua_setglobal(L, "Blackboard");
    }
}

void LuaBindingManager::RegisterBehaviorTree(BehaviorTree* InBT) {
    BT = InBT;
}

void LuaBindingManager::RegisterNavMesh(NavMeshPathfinding* InNavMesh) {
    NavMesh = InNavMesh;
    if (L) {
        lua_pushlightuserdata(L, NavMesh);
        lua_setglobal(L, "NavMesh");
    }
}

void LuaBindingManager::RegisterPerception(VisionPerception* InPerception) {
    Perception = InPerception;
}

void LuaBindingManager::RegisterFunction(const std::string& Name, std::function<int(lua_State*)> Func) {
}

void LuaBindingManager::CallTick(float DeltaTime) {
    if (!L) return;
    lua_getglobal(L, "Tick");
    if (lua_isfunction(L, -1)) {
        lua_pushnumber(L, DeltaTime);
        if (lua_pcall(L, 1, 0, 0) != LUA_OK) {
            std::cerr << "Lua Tick Error: " << lua_tostring(L, -1) << std::endl;
            lua_pop(L, 1);
        }
    } else {
        lua_pop(L, 1);
    }
}

static int Lua_BB_GetResource(lua_State* L) {
    AIBlackboard** BB = reinterpret_cast<AIBlackboard**>(lua_touserdata(L, lua_upvalueindex(1)));
    int Type = static_cast<int>(luaL_checkinteger(L, 1));
    if (BB && *BB) {
        lua_pushinteger(L, (*BB)->GetResource(static_cast<EResourceType>(Type)));
        return 1;
    }
    lua_pushinteger(L, 0);
    return 1;
}

static int Lua_BB_SetResource(lua_State* L) {
    AIBlackboard** BB = reinterpret_cast<AIBlackboard**>(lua_touserdata(L, lua_upvalueindex(1)));
    int Type = static_cast<int>(luaL_checkinteger(L, 1));
    int Amount = static_cast<int>(luaL_checkinteger(L, 2));
    if (BB && *BB) {
        (*BB)->SetResource(static_cast<EResourceType>(Type), Amount);
    }
    return 0;
}

static int Lua_BB_ModifyResource(lua_State* L) {
    AIBlackboard** BB = reinterpret_cast<AIBlackboard**>(lua_touserdata(L, lua_upvalueindex(1)));
    int Type = static_cast<int>(luaL_checkinteger(L, 1));
    int Delta = static_cast<int>(luaL_checkinteger(L, 2));
    if (BB && *BB) {
        (*BB)->ModifyResource(static_cast<EResourceType>(Type), Delta);
    }
    return 0;
}

static int Lua_BB_GetArmySize(lua_State* L) {
    AIBlackboard** BB = reinterpret_cast<AIBlackboard**>(lua_touserdata(L, lua_upvalueindex(1)));
    if (BB && *BB) {
        lua_pushinteger(L, (*BB)->GetArmySize());
        return 1;
    }
    lua_pushinteger(L, 0);
    return 1;
}

static int Lua_BB_GetWorkerCount(lua_State* L) {
    AIBlackboard** BB = reinterpret_cast<AIBlackboard**>(lua_touserdata(L, lua_upvalueindex(1)));
    if (BB && *BB) {
        lua_pushinteger(L, (*BB)->GetWorkerCount());
        return 1;
    }
    lua_pushinteger(L, 0);
    return 1;
}

static int Lua_BB_IsBaseUnderAttack(lua_State* L) {
    AIBlackboard** BB = reinterpret_cast<AIBlackboard**>(lua_touserdata(L, lua_upvalueindex(1)));
    if (BB && *BB) {
        lua_pushboolean(L, (*BB)->IsBaseUnderAttack() ? 1 : 0);
        return 1;
    }
    lua_pushboolean(L, 0);
    return 1;
}

static int Lua_BB_SetValue(lua_State* L) {
    AIBlackboard** BB = reinterpret_cast<AIBlackboard**>(lua_touserdata(L, lua_upvalueindex(1)));
    const char* Key = luaL_checkstring(L, 1);
    if (BB && *BB) {
        if (lua_isboolean(L, 2)) {
            (*BB)->SetValue(Key, static_cast<bool>(lua_toboolean(L, 2)));
        } else if (lua_isinteger(L, 2)) {
            (*BB)->SetValue(Key, static_cast<int>(lua_tointeger(L, 2)));
        } else if (lua_isnumber(L, 2)) {
            (*BB)->SetValue(Key, static_cast<float>(lua_tonumber(L, 2)));
        } else if (lua_isstring(L, 2)) {
            (*BB)->SetValue(Key, std::string(lua_tostring(L, 2)));
        }
    }
    return 0;
}

static int Lua_BB_GetValue(lua_State* L) {
    AIBlackboard** BB = reinterpret_cast<AIBlackboard**>(lua_touserdata(L, lua_upvalueindex(1)));
    const char* Key = luaL_checkstring(L, 1);
    if (BB && *BB) {
        auto It = reinterpret_cast<decltype(AIBlackboard::Data)*>(&(*BB)->Data);
        auto Found = It->find(Key);
        if (Found != It->end()) {
            try {
                if (Found->second.type() == typeid(int)) {
                    lua_pushinteger(L, std::any_cast<int>(Found->second));
                } else if (Found->second.type() == typeid(float)) {
                    lua_pushnumber(L, std::any_cast<float>(Found->second));
                } else if (Found->second.type() == typeid(bool)) {
                    lua_pushboolean(L, std::any_cast<bool>(Found->second) ? 1 : 0);
                } else if (Found->second.type() == typeid(std::string)) {
                    lua_pushstring(L, std::any_cast<std::string>(Found->second).c_str());
                } else {
                    lua_pushnil(L);
                }
                return 1;
            } catch (...) {
            }
        }
    }
    lua_pushnil(L);
    return 1;
}

static int Lua_BB_IsResourceDepleted(lua_State* L) {
    AIBlackboard** BB = reinterpret_cast<AIBlackboard**>(lua_touserdata(L, lua_upvalueindex(1)));
    int Type = static_cast<int>(luaL_checkinteger(L, 1));
    if (BB && *BB) {
        lua_pushboolean(L, (*BB)->IsResourceTypeDepleted(static_cast<EResourceType>(Type)) ? 1 : 0);
        return 1;
    }
    lua_pushboolean(L, 0);
    return 1;
}

static int Lua_BB_AreAllResourcesDepleted(lua_State* L) {
    AIBlackboard** BB = reinterpret_cast<AIBlackboard**>(lua_touserdata(L, lua_upvalueindex(1)));
    if (BB && *BB) {
        lua_pushboolean(L, (*BB)->AreAllResourcesDepleted() ? 1 : 0);
        return 1;
    }
    lua_pushboolean(L, 0);
    return 1;
}

static int Lua_BB_IsInDefenseMode(lua_State* L) {
    AIBlackboard** BB = reinterpret_cast<AIBlackboard**>(lua_touserdata(L, lua_upvalueindex(1)));
    if (BB && *BB) {
        lua_pushboolean(L, (*BB)->IsInDefenseMode() ? 1 : 0);
        return 1;
    }
    lua_pushboolean(L, 0);
    return 1;
}

void LuaBindingManager::BindBlackboard() {
    if (!L || !Blackboard) return;
    
    lua_newtable(L);
    
    lua_pushlightuserdata(L, &Blackboard);
    lua_pushcclosure(L, Lua_BB_GetResource, 1);
    lua_setfield(L, -2, "GetResource");
    
    lua_pushlightuserdata(L, &Blackboard);
    lua_pushcclosure(L, Lua_BB_SetResource, 1);
    lua_setfield(L, -2, "SetResource");
    
    lua_pushlightuserdata(L, &Blackboard);
    lua_pushcclosure(L, Lua_BB_ModifyResource, 1);
    lua_setfield(L, -2, "ModifyResource");
    
    lua_pushlightuserdata(L, &Blackboard);
    lua_pushcclosure(L, Lua_BB_GetArmySize, 1);
    lua_setfield(L, -2, "GetArmySize");
    
    lua_pushlightuserdata(L, &Blackboard);
    lua_pushcclosure(L, Lua_BB_GetWorkerCount, 1);
    lua_setfield(L, -2, "GetWorkerCount");
    
    lua_pushlightuserdata(L, &Blackboard);
    lua_pushcclosure(L, Lua_BB_IsBaseUnderAttack, 1);
    lua_setfield(L, -2, "IsBaseUnderAttack");
    
    lua_pushlightuserdata(L, &Blackboard);
    lua_pushcclosure(L, Lua_BB_SetValue, 1);
    lua_setfield(L, -2, "SetValue");
    
    lua_pushlightuserdata(L, &Blackboard);
    lua_pushcclosure(L, Lua_BB_GetValue, 1);
    lua_setfield(L, -2, "GetValue");
    
    lua_pushlightuserdata(L, &Blackboard);
    lua_pushcclosure(L, Lua_BB_IsResourceDepleted, 1);
    lua_setfield(L, -2, "IsResourceDepleted");
    
    lua_pushlightuserdata(L, &Blackboard);
    lua_pushcclosure(L, Lua_BB_AreAllResourcesDepleted, 1);
    lua_setfield(L, -2, "AreAllResourcesDepleted");
    
    lua_pushlightuserdata(L, &Blackboard);
    lua_pushcclosure(L, Lua_BB_IsInDefenseMode, 1);
    lua_setfield(L, -2, "IsInDefenseMode");
    
    lua_setglobal(L, "BB");
}

static int Lua_BT_CreateSelector(lua_State* L) {
    auto Selector = std::make_shared<BTSelector>();
    *reinterpret_cast<std::shared_ptr<BTSelector>*>(lua_newuserdata(L, sizeof(std::shared_ptr<BTSelector>))) = Selector;
    luaL_setmetatable(L, "BTSelector");
    return 1;
}

static int Lua_BT_CreateSequence(lua_State* L) {
    auto Sequence = std::make_shared<BTSequence>();
    *reinterpret_cast<std::shared_ptr<BTSequence>*>(lua_newuserdata(L, sizeof(std::shared_ptr<BTSequence>))) = Sequence;
    luaL_setmetatable(L, "BTSequence");
    return 1;
}

static int Lua_BT_AddChild(lua_State* L) {
    BTComposite** Comp = reinterpret_cast<BTComposite**>(luaL_checkudata(L, 1, "BTSelector"));
    if (!Comp || !*Comp) {
        Comp = reinterpret_cast<BTComposite**>(luaL_checkudata(L, 1, "BTSequence"));
    }
    if (!Comp || !*Comp) return 0;
    
    BTNode** Child = reinterpret_cast<BTNode**>(luaL_checkudata(L, 2, "BTSelector"));
    if (!Child || !*Child) {
        Child = reinterpret_cast<BTNode**>(luaL_checkudata(L, 2, "BTSequence"));
    }
    if (!Child || !*Child) return 0;
    
    (*Comp)->AddChild(*Child);
    return 0;
}

static int Lua_BT_SetRoot(lua_State* L) {
    return 0;
}

void LuaBindingManager::BindBehaviorTree() {
    if (!L) return;
    
    lua_newtable(L);
    
    lua_pushcfunction(L, Lua_BT_CreateSelector);
    lua_setfield(L, -2, "CreateSelector");
    
    lua_pushcfunction(L, Lua_BT_CreateSequence);
    lua_setfield(L, -2, "CreateSequence");
    
    lua_pushcfunction(L, Lua_BT_AddChild);
    lua_setfield(L, -2, "AddChild");
    
    lua_pushcfunction(L, Lua_BT_SetRoot);
    lua_setfield(L, -2, "SetRoot");
    
    lua_setglobal(L, "BT");
}

static int Lua_Nav_FindPath(lua_State* L) {
    NavMeshPathfinding** NM = reinterpret_cast<NavMeshPathfinding**>(lua_touserdata(L, lua_upvalueindex(1)));
    float SX = static_cast<float>(luaL_checknumber(L, 1));
    float SY = static_cast<float>(luaL_checknumber(L, 2));
    float SZ = static_cast<float>(luaL_checknumber(L, 3));
    float EX = static_cast<float>(luaL_checknumber(L, 4));
    float EY = static_cast<float>(luaL_checknumber(L, 5));
    float EZ = static_cast<float>(luaL_checknumber(L, 6));
    if (NM && *NM) {
        auto Result = (*NM)->FindPath(FVector(SX, SY, SZ), FVector(EX, EY, EZ));
        lua_newtable(L);
        for (size_t i = 0; i < Result.PathPoints.size(); ++i) {
            lua_newtable(L);
            lua_pushnumber(L, Result.PathPoints[i].X);
            lua_rawseti(L, -2, 1);
            lua_pushnumber(L, Result.PathPoints[i].Y);
            lua_rawseti(L, -2, 2);
            lua_pushnumber(L, Result.PathPoints[i].Z);
            lua_rawseti(L, -2, 3);
            lua_rawseti(L, -2, static_cast<int>(i + 1));
        }
        return 1;
    }
    lua_newtable(L);
    return 1;
}

static int Lua_Nav_GetRandomPoint(lua_State* L) {
    NavMeshPathfinding** NM = reinterpret_cast<NavMeshPathfinding**>(lua_touserdata(L, lua_upvalueindex(1)));
    float CX = static_cast<float>(luaL_checknumber(L, 1));
    float CY = static_cast<float>(luaL_checknumber(L, 2));
    float CZ = static_cast<float>(luaL_checknumber(L, 3));
    float Radius = static_cast<float>(luaL_checknumber(L, 4));
    if (NM && *NM) {
        FVector Pt = (*NM)->GetRandomPointAround(FVector(CX, CY, CZ), Radius);
        lua_pushnumber(L, Pt.X);
        lua_pushnumber(L, Pt.Y);
        lua_pushnumber(L, Pt.Z);
        return 3;
    }
    return 0;
}

void LuaBindingManager::BindNavMesh() {
    if (!L) return;
    
    lua_newtable(L);
    
    lua_pushlightuserdata(L, &NavMesh);
    lua_pushcclosure(L, Lua_Nav_FindPath, 1);
    lua_setfield(L, -2, "FindPath");
    
    lua_pushlightuserdata(L, &NavMesh);
    lua_pushcclosure(L, Lua_Nav_GetRandomPoint, 1);
    lua_setfield(L, -2, "GetRandomPointAround");
    
    lua_setglobal(L, "Nav");
}

void LuaBindingManager::BindPerception() {
    if (!L) return;
}

static int Lua_Print(lua_State* L) {
    int N = lua_gettop(L);
    for (int i = 1; i <= N; ++i) {
        if (lua_isstring(L, i)) {
            std::cout << lua_tostring(L, i);
        }
        if (i < N) std::cout << "\t";
    }
    std::cout << std::endl;
    return 0;
}

void LuaBindingManager::BindUtilities() {
    if (!L) return;
    
    lua_register(L, "print", Lua_Print);
    
    lua_newtable(L);
    lua_pushinteger(L, static_cast<int>(EResourceType::Gold));
    lua_setfield(L, -2, "GOLD");
    lua_pushinteger(L, static_cast<int>(EResourceType::Wood));
    lua_setfield(L, -2, "WOOD");
    lua_pushinteger(L, static_cast<int>(EResourceType::Food));
    lua_setfield(L, -2, "FOOD");
    lua_pushinteger(L, static_cast<int>(EResourceType::Stone));
    lua_setfield(L, -2, "STONE");
    lua_setglobal(L, "Resource");
}

void LuaBindingManager::BindAll() {
    BindBlackboard();
    BindBehaviorTree();
    BindNavMesh();
    BindPerception();
    BindUtilities();
}
