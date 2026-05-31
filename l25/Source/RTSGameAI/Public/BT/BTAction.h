#pragma once
#include "BT/BTNode.h"

class BTAction : public BTNode {
public:
    BTStatus Tick(float DeltaTime) override;
protected:
    virtual BTStatus Execute(float DeltaTime) = 0;
};
