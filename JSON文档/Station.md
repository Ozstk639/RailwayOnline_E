[
  {
    "stationName": "普通车站",   //车站名称
    "lines": [                  //经行线路数据
      {
        "bureau": "R",          //路局代码
        "line": "1",            //线路编号
        "stationCode": 1,       //车站编号；取值为1表示此为上行起点车站
        "coord": { "x": 100.0, "y": 64.0, "z": 100.0 },
        //车站坐标，依次为x坐标、y坐标、z坐标
        "distance": 25.0        //站台距离区间起点的长度
      }
    ]
  },

  {
    "stationName": "换乘车站",
    "lines": [
      //多条线经过该站，将所有经行线路数据分别存入lines列表
      {
        "bureau": "R",
        "line": "1",
        "stationCode": 2,
        "coord": { "x": 200.0, "y": 64.0, "z": 100.0 },
        "distance": 100.0       //距离上一站的里程
      },
      {
        "bureau": "R",
        "line": "2",
        "stationCode": 7,
        "coord": { "x": 200.0, "y": 64.0, "z": 64.0 },
        "distance": -1.0        //本线路暂未开通
      },
      {
        "bureau": "R",
        "line": "3",
        "stationCode": 2,
        "coord": { "x": 200.0, "y": 64.0, "z": 132.0 },
        /*"distance": 166.0*/
        //距离可以通过简单的曼哈顿距离计算得出，因此可以省略
      }
    ],

    "specialCases": [ //特殊情况
      {
        "type": "directionNotAvaliable",  //方向未开通
        "target": {                       //无法前往R3-1
          "bureau": "R",
          "line": "3",
          "isTrainUp": true               //上行方向“未开通”
        }
      },
/*
      {
        "type": "lineNotAvaliable",       //线路未开通
        "target": {                       //R2线未开通，不能乘坐
          "bureau": "R",
          "line": "2"
        }
      },
*/
      //lineNotAvaliable 可以通过distance=-1.0的情况确定，因此可以省略；必须使用的情况详见3.4
      {
        "type": "skipStation",            //跳过车站
        "target": {                       //R1线不停R1-3，下一个停靠的站为R1-4
          "bureau": "R",
          "line": "1",
          "stationCode": 4                //4为下一个停靠车站的编号
        }
      }
    ]
  }
]