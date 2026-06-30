# 0.3.0

* add a server side config option to "Enable automatic watch starting and stopping based on navigation.state
  * if this is enabled:
    * subscribe to the navigation.state topic
      * if state transitions from moored|anchored -> sailing|motoring, then start a watch schedule using our default system, teams, and time rounding
      * if state transistions from sailing|motoring -> moored|anchored, then stop our watch schedule
      * ignore any sailing <-> motoring transitions or moored <-> anchored transitions

* communication.crewNames integration
  * change our team config default to an empty array
  * if our config teams array is empty, fall back to using communication.crewNames
  * if communication.crewNames is empty, fall back to using ["Team 1", "Team 2", "Team 3"]