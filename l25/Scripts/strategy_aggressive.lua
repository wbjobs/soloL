-- RTS AI Strategy Script - Aggressive Playstyle
-- With resource depletion detection and defense mode fallback

local StrategyConfig = {
    BuildInterval = 30,
    ProductionInterval = 10,
    AttackArmySize = 10,
    DefenseArmySize = 5,
    GatherPriority = { "GOLD", "WOOD", "FOOD" },
    DepletedFallbackMode = "DEFENSE"
}

local GameTime = 0
local LastBuildTime = 0
local LastProductionTime = 0
local bInDepletedMode = false
local DepletedWarningPrinted = false

function Initialize()
    print("[Lua AI] Aggressive strategy initialized")
    print("[Lua AI] Starting resources: Gold=" .. BB.GetResource(Resource.GOLD) 
          .. " Wood=" .. BB.GetResource(Resource.WOOD)
          .. " Food=" .. BB.GetResource(Resource.FOOD))
end

function OnUnitBuilt(unitType)
    print("[Lua AI] Unit built: " .. unitType)
end

function OnBuildingBuilt(buildingType)
    print("[Lua AI] Building completed: " .. buildingType)
end

function OnEnemyDetected(enemyType, distance)
    print("[Lua AI] Enemy detected: " .. enemyType .. " at distance " .. string.format("%.1f", distance))
end

function OnResourceDepleted(resourceType)
    print("[Lua AI] WARNING: " .. resourceType .. " nodes fully depleted!")
end

function EvaluateBuildOrder()
    if BB.AreAllResourcesDepleted() then
        return false
    end
    
    local gold = BB.GetResource(Resource.GOLD)
    local wood = BB.GetResource(Resource.WOOD)
    
    if gold >= 200 and wood >= 150 then
        return true
    end
    return false
end

function EvaluateProduction()
    if BB.AreAllResourcesDepleted() then
        return false
    end
    
    local gold = BB.GetResource(Resource.GOLD)
    local food = BB.GetResource(Resource.FOOD)
    
    if gold >= 100 and food >= 50 then
        return true
    end
    return false
end

function ShouldAttack()
    if BB.IsInDefenseMode() then
        return BB.IsBaseUnderAttack()
    end
    
    local armySize = BB.GetArmySize()
    local baseUnderAttack = BB.IsBaseUnderAttack()
    
    if baseUnderAttack then
        return true
    end
    
    if armySize >= StrategyConfig.AttackArmySize then
        return true
    end
    
    return false
end

function ShouldDefend()
    if BB.IsInDefenseMode() then
        return true
    end
    return BB.IsBaseUnderAttack()
end

function CheckDepletionState()
    local allDepleted = BB.AreAllResourcesDepleted()
    
    if allDepleted and not bInDepletedMode then
        bInDepletedMode = true
        print("[Lua AI] === ALL RESOURCES DEPLETED === Switching to " .. StrategyConfig.DepletedFallbackMode .. " mode")
        print("[Lua AI] No more gathering possible. Relying on stored resources and defense.")
    elseif not allDepleted and bInDepletedMode then
        bInDepletedMode = false
        print("[Lua AI] Resources available again. Resuming normal strategy.")
    end
    
    local goldDepleted = BB.IsResourceDepleted(Resource.GOLD)
    local woodDepleted = BB.IsResourceDepleted(Resource.WOOD)
    local foodDepleted = BB.IsResourceDepleted(Resource.FOOD)
    
    if goldDepleted and not DepletedWarningPrinted then
        OnResourceDepleted("GOLD")
    end
    if woodDepleted and not DepletedWarningPrinted then
        OnResourceDepleted("WOOD")
    end
    if foodDepleted then
        OnResourceDepleted("FOOD")
        DepletedWarningPrinted = true
    end
end

function Tick(deltaTime)
    GameTime = GameTime + deltaTime
    
    CheckDepletionState()
    
    if math.floor(GameTime) % 10 == 0 and math.floor(GameTime) > 0 then
        local modeStr = bInDepletedMode and " [DEPLETED MODE]" or ""
        print("[Lua AI] GameTime: " .. string.format("%.1f", GameTime) 
              .. "s | Army: " .. BB.GetArmySize()
              .. " | Workers: " .. BB.GetWorkerCount()
              .. " | Defense: " .. tostring(BB.IsInDefenseMode())
              .. modeStr)
    end
end

Initialize()
