#include "BT/BTAction.h"

BTStatus BTAction::Tick(float DeltaTime) {
    return Execute(DeltaTime);
}
