-- RTS AI Strategy Script - Defensive/Economy Playstyle
-- With resource depletion detection and phase-aware defense fallback

local StrategyConfig = {
    WorkerCount = 15,
    BarracksCount = 3,
    DefenseTurretCount = 4,
    AttackArmySize = 15,
    FortificationThreshold = 0.6
}

local GameTime = 0
local BuildPhase = "ECONOMY"
local bResourcesDepleted = false
local DepletedPhase = "SURVIVAL"

function Initialize()
    print("[Lua AI] Defensive strategy initialized")
    print("[Lua AI] Build Phase: ECONOMY -> FORTIFICATION -> ATTACK")
    print("[Lua AI] Depletion fallback: -> SURVIVAL (defense-only)")
end

function GetPhase()
    if bResourcesDepleted then
        return DepletedPhase
    end
    
    local workers = BB.GetWorkerCount()
    local army = BB.GetArmySize()
    
    if workers >= StrategyConfig.WorkerCount and BuildPhase == "ECONOMY" then
        BuildPhase = "FORTIFICATION"
        print("[Lua AI] Phase transition: ECONOMY -> FORTIFICATION")
    end
    
    if army >= StrategyConfig.AttackArmySize and BuildPhase == "FORTIFICATION" then
        BuildPhase = "ATTACK"
        print("[Lua AI] Phase transition: FORTIFICATION -> ATTACK")
    end
    
    return BuildPhase
end

function ShouldBuildWorkers()
    if bResourcesDepleted then
        return false
    end
    return BB.GetWorkerCount() < StrategyConfig.WorkerCount
end

function ShouldBuildBarracks()
    if bResourcesDepleted then
        return false
    end
    return BuildPhase ~= "ECONOMY"
end

function ShouldProduceArmy()
    if bResourcesDepleted then
        return BB.GetResource(Resource.GOLD) >= 100 and BB.GetResource(Resource.FOOD) >= 50
    end
    return BuildPhase == "FORTIFICATION" or BuildPhase == "ATTACK"
end

function ShouldEngageEnemy()
    if bResourcesDepleted then
        return BB.IsBaseUnderAttack()
    end
    
    if BuildPhase == "ATTACK" then
        return true
    end
    
    if BB.IsBaseUnderAttack() then
        return true
    end
    
    return false
end

function GetGatherPriority()
    if bResourcesDepleted then
        return {}
    end
    
    if BuildPhase == "ECONOMY" then
        return { "GOLD", "WOOD", "FOOD" }
    else
        return { "GOLD", "FOOD", "WOOD" }
    end
end

function OnBaseUnderAttack()
    print("[Lua AI] BASE UNDER ATTACK! Switching to defense mode")
    local prevPhase = BuildPhase
    BuildPhase = "FORTIFICATION"
    return prevPhase
end

function CheckResourceDepletion()
    local wasDepleted = bResourcesDepleted
    bResourcesDepleted = BB.AreAllResourcesDepleted()
    
    if bResourcesDepleted and not wasDepleted then
        print("[Lua AI] === ALL RESOURCES DEPLETED === Entering SURVIVAL phase")
        print("[Lua AI] Switching to defense-only. Stored resources will be consumed.")
        DepletedPhase = "SURVIVAL"
    elseif not bResourcesDepleted and wasDepleted then
        print("[Lua AI] Resources recovered! Returning to " .. BuildPhase .. " phase")
        bResourcesDepleted = false
    end
    
    if not bResourcesDepleted then
        if BB.IsResourceDepleted(Resource.GOLD) then
            print("[Lua AI] WARNING: Gold nodes depleted")
        end
        if BB.IsResourceDepleted(Resource.WOOD) then
            print("[Lua AI] WARNING: Wood nodes depleted")
        end
    end
end

function Tick(deltaTime)
    GameTime = GameTime + deltaTime
    
    CheckResourceDepletion()
    
    if math.floor(GameTime) % 15 == 0 and math.floor(GameTime) > 0 then
        local phase = GetPhase()
        local depletedStr = bResourcesDepleted and " [DEPLETED]" or ""
        print("[Lua AI] Time: " .. string.format("%.1f", GameTime) 
              .. "s | Phase: " .. phase
              .. " | Army: " .. BB.GetArmySize()
              .. " | Workers: " .. BB.GetWorkerCount()
              .. " | Defense: " .. tostring(BB.IsInDefenseMode())
              .. depletedStr)
    end
end

Initialize()
