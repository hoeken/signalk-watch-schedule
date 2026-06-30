# 0.3.0

* add a server side config option to "Enable automatic watch starting and stopping based on navigation.state
  * if this is enabled:
    * subscribe to the navigation.state topic
      * if state transitions from moored|anchored -> sailing|motoring, then start a watch schedule using our default system, teams, and time rounding
      * if state transistions from sailing|motoring -> moored|anchored, then stop our watch schedule
      * ignore any sailing <-> motoring transitions or moored <-> anchored transitions

# Long Term

* add option to use crew from a plugin that provides crew - which one?