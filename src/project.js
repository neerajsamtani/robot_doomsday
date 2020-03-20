import {tiny, defs} from './common.js';
                                                  // Pull these names into this module's scope for convenience:
const { Triangle, Square, Tetrahedron, Windmill, Cube, Subdivision_Sphere, Capped_Cylinder, Grid_Patch } = defs;
// Pull these names into this module's scope for convenience:

const { vec3, vec4, vec, color, Mat4, Light, Shape, Material, Shader, Texture, Scene } = tiny;

let g_dx = 0, g_dy = 0;
let g_origin_offset = vec3(0, 0, 0);
let g_cam_looking_at = vec3(NaN, NaN, NaN);
let g_x_ccs = vec3(1, 0, 0);
let g_z_ccs = vec3(0, 0, 1);
let g_z_rot = 0;
let x_rotation_angle = 0;
let next_spawn_location = 0;
let spawn_locations = [vec3(0, 0.3, 25), vec3(25, 0.3, 0), vec3(-25, 0.3, 0), vec3(10, 0.3, 25), vec3(25, 0.3, -10), vec3(-25, 0.3, 10)];
let max_robots = 11;
let kills = 0;
let closest_robot_dist = 999999;
let g_pseudo_cam = Mat4.look_at(vec3(0, 0, 0), vec3(0, 0, -1), vec3(0, 1, 0));
let g_immovable_objs = [];

const FPS_Controls =
class FPS_Controls extends defs.Movement_Controls
{
  constructor()
  {
    super();
  }

  add_mouse_controls(canvas)
  {
    this.mouse = { "from_center": vec( 0,0 ) };
    const mouse_position = (e, rect = canvas.getBoundingClientRect()) =>
        vec( e.clientX - (rect.left + rect.right)/2, e.clientY - (rect.bottom + rect.top)/2 );
    document.addEventListener( "mouseup",   e => { this.mouse.anchor = undefined; } );
    canvas.addEventListener( "mousedown", e => { e.preventDefault(); this.mouse.anchor = mouse_position(e); } );
    canvas.addEventListener( "mousemove", e => { e.preventDefault(); this.mouse.from_center = mouse_position(e); } );
    canvas.addEventListener( "mouseout",  e => { if( !this.mouse.anchor ) this.mouse.from_center.scale_by(0) } );

    canvas.onclick = () => canvas.requestPointerLock();

    let updatePosition = (e) => {
      g_dx = e.movementX;
      g_dy = e.movementY;
    };

    let lockChangeAlert = () => {
      if (document.pointerLockElement === canvas) {
        document.addEventListener("mousemove", updatePosition, false);
      } else {
        document.removeEventListener("mousemove", updatePosition, false);
        g_dx = g_dy = 0;
      }
    };

    document.addEventListener('pointerlockchange', lockChangeAlert, false);
  }

  // This function is called when the user executes the movement keys, i.e. WASD.
  first_person_flyaround(radians_per_frame, meters_per_frame, leeway = 70 )
  {
    // We do not want the user to move up/down i.e. along the y axis. So we do not
    // accommodate for this.thrust[1] which is the axis.
    // The thrust values are subtracted from the g_origin_offset because we want the
    // objects to do the opposite of what I'm doing so it looks as if the cam is moving.
    let future_origin_offset = vec3(NaN, NaN, NaN);
    Object.assign(future_origin_offset, g_origin_offset);

    if (this.thrust[0] !== 0) {
      future_origin_offset[0] += 1 * this.thrust[0] * g_x_ccs[0] * .1;
      future_origin_offset[2] += 1 * this.thrust[0] * g_x_ccs[2] * .1;
    }
    if (this.thrust[2] !== 0) {
      future_origin_offset[0] += 1 * this.thrust[2] * g_z_ccs[0] * .1;
      future_origin_offset[2] += 1 * this.thrust[2] * g_z_ccs[2] * .1;
    }

    // Prevent the player from running into solid objects.
    const origin = vec3(0, 0, 0);
    const euclid_dist_xz = (p, q) => {
      return Math.sqrt(Math.pow(p[0] - q[0], 2) +
          Math.pow( p[2] - q[2], 2));
    };
    let future_dist = euclid_dist_xz(future_origin_offset, origin);
    let cur_dist = euclid_dist_xz(g_origin_offset, origin);

    for (let [i, o] of g_immovable_objs.entries()) {
      // I know the pond is added last, and thus last in the immovable object list.
      // By adding this exception, we allow the user to stand on the pond.
      if (i === 36)
        break;
      let o_pos_mat = Mat4.identity().times(Mat4.translation(...g_origin_offset)).times(o.location);
      let o_pos = vec3(o_pos_mat[0][3], o_pos_mat[1][3], o_pos_mat[2][3]);
      let dist = euclid_dist_xz(o_pos, origin);
      // The future_dist and cur_dist comparison make it so we can "unwedge" ourselves.
      if (dist < o.margin * 4  && future_dist > cur_dist) {
        return;
      }
    }
    // Prevent the player from running off the map.
    if (future_dist > 45) {
      return;
    }

    // Not outside fence, we are fine, commit the movement change.
    Object.assign(g_origin_offset, future_origin_offset);
  }

  // This function is called whenever the mouse is moved.
  third_person_arcball(radians_per_frame)
  {
    // The rotation that we do depends ONLY on the mouse dx and dy, stored in the global variables.
    let dragging_vector = vec(g_dx, g_dy).times(40);
    // Reset the deltas so we don't keep rotating if the pointer unlocks.
    g_dx = g_dy = 0;

    if( dragging_vector.norm() <= 0 )
      return;

    // Rotate around the y axis, i.e. horizontal movement.
    let horiz_rot;
    if (dragging_vector[0] !== 0) {
      // let y_ccs = this.matrix().times(vec4(0, 1, 0, 0)).to3();
      let y_ccs = g_pseudo_cam.times(vec4(0, 1, 0, 0)).to3();
      let rot_angle = radians_per_frame * dragging_vector.norm() * (dragging_vector[0] > 0 ? 1 : -1);
      horiz_rot = Mat4.rotation(rot_angle, y_ccs[0], y_ccs[1], y_ccs[2]);
    }

    // Report the x and z axis w.r.t. camera coordinate system.
    g_x_ccs = Mat4.inverse(g_pseudo_cam).times(vec4(1, 0, 0, 0)).to3();
    g_z_ccs = Mat4.inverse(g_pseudo_cam).times(vec4(0, 0, 1, 0)).to3();

    if (horiz_rot) {
      g_pseudo_cam.post_multiply(horiz_rot);
    }

    let z_angle = Math.atan2(g_z_ccs[2], g_z_ccs[0]) - Math.atan2(1, 0);
    g_z_rot = z_angle;
  }

  display(context, graphics_state, dt = graphics_state.animation_delta_time / 1000)
  {
    const m = this.speed_multiplier * this.meters_per_frame;
    const r = this.speed_multiplier * this.radians_per_frame;

    if (this.will_take_over_graphics_state)
    {
      this.reset(graphics_state);
      this.will_take_over_graphics_state = false;
    }
    if (!this.mouse_enabled_canvases.has(context.canvas))
    {
      this.add_mouse_controls(context.canvas);
      this.mouse_enabled_canvases.add(context.canvas);
    }

    this.first_person_flyaround(dt * r, dt * m);

    // We only want to move our view if we are locked into the canvas.
    if (!this.mouse.anchor)
      this.third_person_arcball(dt * r);

    this.pos = this.inverse().times(vec4(0, 0, 0, 1));
    this.z_axis = this.inverse().times(vec4(0, 0, 1, 0));
  }
};

class Body{
  constructor(x = 0, y = 0, z = 0){
    this.location = Mat4.identity().times(Mat4.translation(x,y,z));
    this.state = 0;
    this.margin = 1;
  }
  intersect_sphere(p, margin = 0){
    return p.dot(p) < 1 + margin;
  }

  check_if_colliding(target){
    if (this == target)
      return false;
    let e_dist = Math.sqrt(Math.pow(target.location[0][3] - this.location[0][3], 2) + Math.pow(target.location[2][3] - this.location[2][3], 2));
    return e_dist < target.margin + this.margin;
  }
}

class Immovable extends Body{
  constructor(x, y, z, m = 1){
    super(x, y, z);
    this.margin = m;
  }
}

class Robot extends Body {
  constructor(x, y, z){
    super(x, y, z);
    this.location = this.location.times(Mat4.scale(0.5, 0.5, 0.5))
    this.margin = 1 + this.state;
    this.linear_velocity = [0,0,0];   // Initial Linear Velocity - for explosion of robot
    this.time = 0;                    // Time once start explosion to map Kinematics Properties
    this.x_diff = 0;
    this.z_diff = 0;
    this.e_dist = 1;

    this.bounce_t = 0;
    
    // Body Part Matrix Locations
    this.torso = 0;
    this.bottom_torso = 0;
    this.head = 0;
    this.left_arm = 0;
    this.left_hand = 0;
    this.right_arm = 0;
    this.right_hand = 0;

    // Body Part Properties 
    // [1] - rebound y-velocity
    // [2] - time of rebound (this.t at first hit of ground)
    this.torso_prop = [0, 0];
    this.head_prop = [0,0];
    this.arm_prop = [0,0];

    this.broken_parts = 0;
    this.euclidean_dist = 0;
  }
}

export class Shape_From_File extends Shape
{                                   // **Shape_From_File** is a versatile standalone Shape that imports
                                    // all its arrays' data from an .obj 3D model file.
  constructor( filename )
  { super( "position", "normal", "texture_coord" );
    // Begin downloading the mesh. Once that completes, return
    // control to our parse_into_mesh function.
    this.load_file( filename );
  }
  load_file( filename )
  {                             // Request the external file and wait for it to load.
    // Failure mode:  Loads an empty shape.
    return fetch( filename )
        .then( response =>
        { if ( response.ok )  return Promise.resolve( response.text() )
        else                return Promise.reject ( response.status )
        })
        .then( obj_file_contents => this.parse_into_mesh( obj_file_contents ) )
        .catch( error => { this.copy_onto_graphics_card( this.gl ); } )
  }
  parse_into_mesh( data )
  {                           // Adapted from the "webgl-obj-loader.js" library found online:
    var verts = [], vertNormals = [], textures = [], unpacked = {};

    unpacked.verts = [];        unpacked.norms = [];    unpacked.textures = [];
    unpacked.hashindices = {};  unpacked.indices = [];  unpacked.index = 0;

    var lines = data.split('\n');

    var VERTEX_RE = /^v\s/;    var NORMAL_RE = /^vn\s/;    var TEXTURE_RE = /^vt\s/;
    var FACE_RE = /^f\s/;      var WHITESPACE_RE = /\s+/;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      var elements = line.split(WHITESPACE_RE);
      elements.shift();

      if      (VERTEX_RE.test(line))   verts.push.apply(verts, elements);
      else if (NORMAL_RE.test(line))   vertNormals.push.apply(vertNormals, elements);
      else if (TEXTURE_RE.test(line))  textures.push.apply(textures, elements);
      else if (FACE_RE.test(line)) {
        var quad = false;
        for (var j = 0, eleLen = elements.length; j < eleLen; j++)
        {
          if(j === 3 && !quad) {  j = 2;  quad = true;  }
          if(elements[j] in unpacked.hashindices)
            unpacked.indices.push(unpacked.hashindices[elements[j]]);
          else
          {
            var vertex = elements[ j ].split( '/' );

            unpacked.verts.push(+verts[(vertex[0] - 1) * 3 + 0]);
            unpacked.verts.push(+verts[(vertex[0] - 1) * 3 + 1]);
            unpacked.verts.push(+verts[(vertex[0] - 1) * 3 + 2]);

            if (textures.length)
            {   unpacked.textures.push(+textures[( (vertex[1] - 1)||vertex[0]) * 2 + 0]);
              unpacked.textures.push(+textures[( (vertex[1] - 1)||vertex[0]) * 2 + 1]);  }

            unpacked.norms.push(+vertNormals[( (vertex[2] - 1)||vertex[0]) * 3 + 0]);
            unpacked.norms.push(+vertNormals[( (vertex[2] - 1)||vertex[0]) * 3 + 1]);
            unpacked.norms.push(+vertNormals[( (vertex[2] - 1)||vertex[0]) * 3 + 2]);

            unpacked.hashindices[elements[j]] = unpacked.index;
            unpacked.indices.push(unpacked.index);
            unpacked.index += 1;
          }
          if(j === 3 && quad)   unpacked.indices.push( unpacked.hashindices[elements[0]]);
        }
      }
    }
    {
      const { verts, norms, textures } = unpacked;
      for( var j = 0; j < verts.length/3; j++ )
      {
        this.arrays.position     .push( vec3( verts[ 3*j ], verts[ 3*j + 1 ], verts[ 3*j + 2 ] ) );
        this.arrays.normal       .push( vec3( norms[ 3*j ], norms[ 3*j + 1 ], norms[ 3*j + 2 ] ) );
        this.arrays.texture_coord.push( vec( textures[ 2*j ], textures[ 2*j + 1 ] ) );
      }
      this.indices = unpacked.indices;
    }
    this.normalize_positions( false );
    this.ready = true;
  }
  draw( context, program_state, model_transform, material )
  {               // draw(): Same as always for shapes, but cancel all
    // attempts to draw the shape before it loads:
    if( this.ready )
      super.draw( context, program_state, model_transform, material );
  }
}
export class Project_Base extends Scene {

  constructor() {                  // constructor(): Scenes begin by populating initial values like the Shapes and Materials they'll need.
    super();
    this.robots = [];
    this.immovables = [];
    this.lasers = [];
    this.hover = this.swarm = false;
    const initial_corner_point = vec3(-10, -10, 0);
    const row_operation = (s, p) => p ? Mat4.translation(0, .08, 0).times(p.to4(10)).to3() : initial_corner_point;
    const column_operation = (t, p) => Mat4.translation(.08, 0, 0).times(p.to4(10)).to3();

    // Setup Sounds
    this.died = false; // Used to ensure that the die sound plays only once
    this.won = false; // Used to ensure that the won sound plays only once
    this.die_sound = new Audio();
    this.die_sound.src = 'assets/argh.wav';
    this.woohoo_sound = new Audio();
    this.woohoo_sound.src = 'assets/woohoo.wav';
    this.shoot_sound = new Audio();
    this.shoot_sound.src = 'assets/shoot.wav';

    this.shapes = {
      'box': new Cube(),
      'ball': new Subdivision_Sphere(4),
      "head": new Shape_From_File("assets/Head.obj"),
      "top_torso": new Shape_From_File("assets/Top-Torso.obj"),
      "bottom_torso": new Shape_From_File("assets/Bottom-Torso.obj"),
      "left_arm": new Shape_From_File("assets/Left-Arm.obj"),
      "left_hand": new Shape_From_File("assets/Left-Hand.obj"),
      "right_arm": new Shape_From_File("assets/Right-Arm.obj"),
      "right_hand": new Shape_From_File("assets/Right-Hand.obj"),
      "ground": new Capped_Cylinder(100, 100, [[0, 2], [0, 1]]),
      "skybox": new Subdivision_Sphere(4),
      "tree_trunk": new Shape_From_File("assets/tree_trunk.obj"),
      "tree_leaves": new Shape_From_File("assets/tree_leaves.obj"),
      "rock": new Shape_From_File("assets/rock.obj"),
      "pistol": new Shape_From_File("assets/ray_gun.obj"),
      "pond": new defs.Grid_Patch(10, 10, row_operation, column_operation),
      "wall": new Cube(),
      "fence": new  Shape_From_File("assets/oldfence.obj")
    };

    this.shapes.ground.arrays.texture_coord.forEach(p => p.scale_by(50));
    const phong = new defs.Phong_Shader();
    const textured = new defs.Textured_Phong(1);
    this.materials = {
      plastic: new Material(phong,
          {ambient: .2, diffusivity: 1, specularity: .5, color: color(.9, .5, .9, 1)}),
      metal: new Material(phong,
          {ambient: .2, diffusivity: 1, specularity: 1, color: color(.9, .5, .9, 1)}),
      robot_texture: new Material(textured, {
        color: color(.5, .5, .5, 1),
        ambient: .3, diffusivity: .5, specularity: .5, texture: new Texture("assets/R1_Color.jpg")
      }),
      ground: new Material(textured, {ambient: 1, specularity: 0.2, texture: new Texture("assets/grass2.jpg")}),
      sky: new Material(textured, {
        ambient: 1,
        specularity: 0.2,
        texture: new Texture("assets/sky.jpg"),
        color: color(0, 0, 0, 1)
      }),
      tree_leaves: new Material(phong, {ambient: .2, diffusivity: 1, specularity: .5, color: color(0, 0.9, .1, 1)}),
      tree_trunk: new Material(phong, {ambient: .2, diffusivity: 1, specularity: .5, color: color(0.9, 0.4, 0.1, 1)}),
      rock: new Material(textured, {
        ambient: 1,
        specularity: 1,
        texture: new Texture("assets/rock.png"),
        color: color(0, 0, 0, 1)
      }),
      water: new Material(textured, {
        ambient: 0.7,
        specularity: 1,
        texture: new Texture("assets/water.jpg"),
        color: color(0, 0, 0, 1)
      }),
      night_sky: new Material(textured, {
        ambient: 1,
        specularity: 0.1,
        texture: new Texture("assets/starrysky.png"),
        color: color(0, 0, 0, 1)
      }),
      score0: new Material(textured, {
        ambient: 1,
        texture: new Texture("assets/0.png"),
        color: color(0, 0, 0, 1)
      }),
      score1: new Material(textured, {
        ambient: 1,
        texture: new Texture("assets/1.png"),
        color: color(0, 0, 0, 1)
      }),
      score2: new Material(textured, {
        ambient: 1,
        texture: new Texture("assets/2.png"),
        color: color(0, 0, 0, 1)
      }),
      score3: new Material(textured, {
        ambient: 1,
        texture: new Texture("assets/3.png"),
        color: color(0, 0, 0, 1)
      }),
      score4: new Material(textured, {
        ambient: 1,
        texture: new Texture("assets/4.png"),
        color: color(0, 0, 0, 1)
      }),
      score5: new Material(textured, {
        ambient: 1,
        texture: new Texture("assets/5.png"),
        color: color(0, 0, 0, 1)
      }),
      score6: new Material(textured, {
        ambient: 1,
        texture: new Texture("assets/6.png"),
        color: color(0, 0, 0, 1)
      }),
      score7: new Material(textured, {
        ambient: 1,
        texture: new Texture("assets/7.png"),
        color: color(0, 0, 0, 1)
      }),
      score8: new Material(textured, {
        ambient: 1,
        texture: new Texture("assets/8.png"),
        color: color(0, 0, 0, 1)
      }),
      score9: new Material(textured, {
        ambient: 1,
        texture: new Texture("assets/9.png"),
        color: color(0, 0, 0, 1)
      }),
      score10: new Material(textured, {
        ambient: 1,
        texture: new Texture("assets/10.png"),
        color: color(0, 0, 0, 1)
      }),
      winner: new Material(textured, {
        ambient: 1,
        texture: new Texture("assets/winner.png"),
        color: color(0, 0, 0, 1)
      }),
      game_over: new Material(textured, {
        ambient: 1,
        texture: new Texture("assets/game_over.png"),
        color: color(0, 0, 0, 1)
      }),
      raygun: new Material(textured, {
        ambient: 1,
        texture: new Texture("assets/raygun.png"),
        color: color(0, 0, 0, 1)
      }),
    };

    this.time_of_day = "day";
    this.random_x = [];
    this.random_z = [];
    var theta = 0;
    for (var i = 0; i < 36; i += 1) {
      var R = 18 + 28 * Math.random();
      var theta1 = Math.random() * 0.174533 + theta;
      this.random_x.push(R * Math.cos(theta1));
      this.random_z.push(R * Math.sin(theta1));
      this.immovables.push(new Immovable(this.random_x[i], .3, this.random_z[i]));
      theta += 0.174533;
    }

    // Pond
    this.immovables.push(new Immovable(-5, 0, -5, 5));

    // Store reference to array in global variable so I can access in another class.
    g_immovable_objs = this.immovables;

    this.night_lights = [new Light(vec4(0, -1, 1, 0), color(1, 1, 1, 1), 1)];
    this.day_lights = [new Light(vec4(0, -1, 1, 0), color(1, 1, 1, 1), 10000)];

    this.fired_bullet = true;
    this.pistol_transform = Mat4.identity();
    this.bullet_transform = this.pistol_transform;

  }

  make_control_panel() {

    this.new_line();

    this.key_triggered_button("Kill a robot", [" "], function () {
      this.fired_bullet = true;
      this.shoot_sound.play();
      let oot = Mat4.identity()
          .times(Mat4.rotation(g_z_rot, 0, 1, 0))
          .times(Mat4.translation(...g_origin_offset));
      let index = -1;
      for (let i = 0; i < this.robots.length; i++) {
        if (this.robots[i].state == 0) {
          let x_location_diff = oot.times(this.robots[i].location)[0][3];
          if (x_location_diff < 1.8 && x_location_diff > -1.8) {
            index = i;
            break;
          }
        }
      }
      if (index > -1) {
        this.robots[index].state = 1;
        this.robots[index].time = this.t;
        this.robots[index].linear_velocity[0] = (Math.random() + 1) * 1.2;
        this.robots[index].linear_velocity[1] = (Math.random() + 1) * 1.2;
        this.robots[index].linear_velocity[2] = (Math.random() + 1) * 1.2;
        if (this.robots.length < max_robots) {
          next_spawn_location = (next_spawn_location + 1) % 6;
          this.robots.push(new Robot(...spawn_locations[next_spawn_location]));
          kills += 1;
        } else {
          kills += 1;
        }
      }

    });
    this.key_triggered_button("switch time of day", ["n"], function () {
      if (this.time_of_day == "day") {
        this.time_of_day = "night";
      } else {
        this.time_of_day = "day";
      }
    });
  }

  display(context, program_state) {
    // "Constructor" statements would go within this if
    // We do it here instead of the constructor above so that we have access to context and program state
    if (!context.scratchpad.controls) {
      // this.children.push( context.scratchpad.controls = new defs.Movement_Controls() );
      this.children.push(context.scratchpad.controls = new FPS_Controls());
      // program_state.set_camera( Mat4.translation( 0,0,0 ) );
      program_state.set_camera(Mat4.look_at(vec3(0, 0, 0), vec3(0, 0, -1), vec3(0, 1, 0)));

      // Spawn all robots
      this.robots.push(new Robot(0, 0.3, -25));
      this.robots.push(new Robot(10, 0.3, -45));
      this.robots.push(new Robot(-10, 0.3, -45));
      //  0 means alive - 1 means animate collapse - 2 means stay collapsed
    }

    // Default Required Variables
    program_state.projection_transform = Mat4.perspective(Math.PI / 4, context.width / context.height, 1, 150);
    const t = this.t = program_state.animation_time / 1000;
    const angle = Math.sin(t);
    if (this.time_of_day == "day")
      program_state.lights = this.day_lights;
    else
      program_state.lights = this.night_lights;
  }

  set_bounce(b, x, z){
    b.bounce_t = 1;
    b.x_diff = x;
    b.z_diff = z;
  }

  set_collapse(b) {
    b.state = 1;
    b.time = this.t;
    b.linear_velocity[0] = (Math.random() + 1) * 1.2;
    b.linear_velocity[1] = (Math.random() + 1) * 1.2;
    b.linear_velocity[2] = (Math.random() + 1) * 1.2;
  }

  draw_robot(context, program_state, index) {
    let robot_state = this.robots[index].state;
    let t = program_state.animation_time / 1000;
    // Variable oot is the origin offset transformation.
    let oot = Mat4.identity()
        .times(Mat4.rotation(g_z_rot, 0, 1, 0))
        .times(Mat4.translation(...g_origin_offset));
   
    // Calculate robot's planned path
    if(this.robots[index].bounce_t == 0){
      this.robots[index].x_diff = Mat4.translation(...g_origin_offset).times(this.robots[index].location)[0][3];
      this.robots[index].z_diff = Mat4.translation(...g_origin_offset).times(this.robots[index].location)[2][3];
      this.robots[index].e_dist = Math.sqrt(Math.pow(this.robots[index].x_diff, 2) + Math.pow(this.robots[index].z_diff, 2));
    }

    let x_location_diff = this.robots[index].x_diff;
    let z_location_diff = this.robots[index].z_diff;
    let euclidean_dist = this.robots[index].e_dist ? this.robots[index].e_dist : 1;

    // Prevent robot from flipping 180 degrees when out of the range of Math.atan
    if (x_location_diff > 0 && z_location_diff > 0)
      x_rotation_angle = Math.atan(x_location_diff / z_location_diff) - Math.PI;
    else if (x_location_diff < 0 && z_location_diff > 0)
      x_rotation_angle = Math.atan(x_location_diff / z_location_diff) + Math.PI;
    else
      x_rotation_angle = Math.atan((x_location_diff) / (z_location_diff));

    // Alive
    if (robot_state == 0) {

      // Find the closest robot. Allows the player to die
      if (euclidean_dist < closest_robot_dist)
        closest_robot_dist = euclidean_dist;

      for (let c of this.immovables) {
        if (this.robots[index].check_if_colliding(c) && this.robots[index].bounce_t == 0)
        this.robots[index].bounce_t = 1;
      }
      for (let b of this.robots) {
        if (this.robots[index] != b && this.robots[index].check_if_colliding(b) && this.robots[index].bounce_t == 0)
          this.robots[index].bounce_t = 1;
      }

      if(this.robots[index].bounce_t == 0){
        // Separate translation from rotation
        // Update the translation globally so that the robots movement is procedural
        this.robots[index].location = this.robots[index].location
            .times(Mat4.translation(-1 * x_location_diff / (10 * euclidean_dist), 0, -1 * z_location_diff / (10 * euclidean_dist)));
      }else{
        this.robots[index].location = this.robots[index].location
            .times(Mat4.translation(1 * x_location_diff / ( 10 * euclidean_dist), 0,  1 * z_location_diff / (10* euclidean_dist)));
        this.robots[index].bounce_t+=1;
      }

      if(this.robots[index].bounce_t >= 20)
        this.robots[index].bounce_t = 0;

      // Update the rotation locally so that the robots rotation doesn't multiply with itself, causing it to spin like crazy
      var top_torso_transform = this.robots[index].location.times(Mat4.rotation(x_rotation_angle, 0, 1, 0));
      this.robots[index].torso = top_torso_transform.times(Mat4.translation(0, 0, 0));
      this.robots[index].head = top_torso_transform.times(Mat4.translation(0, 2.9, 0));
      this.robots[index].bottom_torso = top_torso_transform.times(Mat4.rotation(Math.PI, 0, 1, 0))
          .times(Mat4.translation(0, -2.0, 0));
      this.robots[index].left_arm = top_torso_transform.times(Mat4.translation(2, 0, 0));
      this.robots[index].left_hand = top_torso_transform.times(Mat4.translation(2.9, -2.7, 0))
          .times(Mat4.scale(0.5, 0.5, 0.5));
      this.robots[index].right_arm = top_torso_transform.times(Mat4.translation(-2, 0, 0));
      this.robots[index].right_hand = top_torso_transform.times(Mat4.translation(-2.9, -2.7, 0))
          .times(Mat4.scale(0.5, 0.5, 0.5));
    }

    // Collapse
    else if (robot_state == 1) {

      let broken_parts = 0;
      var top_torso_transform = this.robots[index].location.times(Mat4.rotation(x_rotation_angle, 0, 1, 0));
      let t = (this.t - this.robots[index].time) * 1.5;
      let x = this.robots[index].linear_velocity[0] * t;
      let y = (-1) / 2 * 9.8 * t * t + this.robots[index].linear_velocity[1] * t;
      let z = this.robots[index].linear_velocity[2] * t;

      // Head collapse and bounce
      if (this.robots[index].head[1][3] < this.robots[index].location[1][3] - .9 && this.robots[index].head_prop[0] && (this.t - this.robots[index].head_prop[1]) > .5) {
        this.robots[index].broken_parts |= 1;
      } else if (this.robots[index].head[1][3] < this.robots[index].location[1][3] - .9 && this.robots[index].head_prop[0] == 0) {
        this.robots[index].head_prop[0] = -1.7 * (this.robots[index].linear_velocity[1] - 9.8 * t);
        this.robots[index].head_prop[1] = this.t;
      } else {
        let t2 = (this.t - this.robots[index].head_prop[1]) * 1.5;
        let rebound = (-1) / 2 * 9.8 * t2 * t2 + this.robots[index].head_prop[0] * t2;
        let y1 = this.robots[index].head_prop[1] == 0 ? y : y + rebound;
        this.robots[index].head = top_torso_transform.times(Mat4.translation(x * .5, 2.9 + y1, z));
      }

      // torso collapse and bounce
      if (this.robots[index].torso[1][3] < this.robots[index].location[1][3] - 1 && this.robots[index].torso_prop[0] && (this.t - this.robots[index].torso_prop[1]) > .2) {
        this.robots[index].broken_parts |= 2;
      } else if (this.robots[index].torso[1][3] < this.robots[index].location[1][3] - 1 && this.robots[index].torso_prop[0] == 0) {
        this.robots[index].torso_prop[0] = 2 * (this.robots[index].linear_velocity[1] - 9.8 * t);
        this.robots[index].torso_prop[1] = this.t;
      } else {
        let t2 = (this.t - this.robots[index].torso_prop[1]) * 1.5;
        let rebound = (-1) / 2 * 9.8 * t2 * t2 + this.robots[index].torso_prop[0] * t2;
        let y2 = this.robots[index].torso_prop[1] == 0 ? y : y + rebound;
        this.robots[index].torso = this.robots[index].location.times(Mat4.translation(-x * .5, y2 + rebound, -z));
        this.robots[index].bottom_torso = top_torso_transform.times(Mat4.rotation(Math.PI, 0, 1, 0))
            .times(Mat4.translation(0, -2.0, 0));
      }

      //Arm collapse and bounce
      if (this.robots[index].left_arm[1][3] < this.robots[index].location[1][3] - 1.4 && this.robots[index].arm_prop[0] && (this.t - this.robots[index].arm_prop[1]) > .2) {
        this.robots[index].broken_parts |= 4;
      } else if (this.robots[index].left_arm[1][3] < this.robots[index].location[1][3] - 1.4 && this.robots[index].arm_prop[0] == 0) {
        this.robots[index].arm_prop[0] = -1.7 * (this.robots[index].linear_velocity[1] - 9.8 * t);
        this.robots[index].arm_prop[1] = this.t;
      } else {
        let t2 = (this.t - this.robots[index].arm_prop[1]) * 1.5;
        let rebound = (-1) / 2 * 9.8 * t2 * t2 + this.robots[index].arm_prop[0] * t2;
        let y3 = this.robots[index].arm_prop[1] == 0 ? y : y + rebound;
        this.robots[index].left_arm = top_torso_transform.times(Mat4.translation(2 + x, y3, 0)).times(Mat4.rotation(Math.PI / 3, 0, 0, 1));
        this.robots[index].left_hand = top_torso_transform.times(Mat4.translation(5.0 + x, -.5 + y3, 0))
            .times(Mat4.scale(0.5, 0.5, 0.5)).times(Mat4.rotation(Math.PI / 3, 0, 0, 1));
        this.robots[index].right_arm = top_torso_transform.times(Mat4.translation(-2 - x, y3, 0)).times(Mat4.rotation(Math.PI / 3, 0, 0, -1));
        this.robots[index].right_hand = top_torso_transform.times(Mat4.translation(-5 - x, -.5 + y3, 0))
            .times(Mat4.scale(0.5, 0.5, 0.5)).times(Mat4.rotation(Math.PI / 3, 0, 0, -1));
      }
      if (this.robots[index].broken_parts == 7) {
        this.robots[index].state = 2;
      }
    }

    // Draw Robot at robot_center
    if (this.time_of_day == "day") {
      this.shapes.head.draw(context, program_state, oot.times(this.robots[index].head), this.materials.robot_texture);
      this.shapes.top_torso.draw(context, program_state, oot.times(this.robots[index].torso), this.materials.robot_texture);
      this.shapes.bottom_torso.draw(context, program_state, oot.times(this.robots[index].bottom_torso), this.materials.robot_texture);
      this.shapes.left_arm.draw(context, program_state, oot.times(this.robots[index].left_arm), this.materials.robot_texture);
      this.shapes.left_hand.draw(context, program_state, oot.times(this.robots[index].left_hand), this.materials.robot_texture);
      this.shapes.right_arm.draw(context, program_state, oot.times(this.robots[index].right_arm), this.materials.robot_texture);
      this.shapes.right_hand.draw(context, program_state, oot.times(this.robots[index].right_hand), this.materials.robot_texture);
    } else {
      this.shapes.head.draw(context, program_state, oot.times(this.robots[index].head), this.materials.robot_texture.override({ambient: 0.1}));
      this.shapes.top_torso.draw(context, program_state, oot.times(this.robots[index].torso), this.materials.robot_texture.override({ambient: 0.1}));
      this.shapes.bottom_torso.draw(context, program_state, oot.times(this.robots[index].bottom_torso), this.materials.robot_texture.override({ambient: 0.1}));
      this.shapes.left_arm.draw(context, program_state, oot.times(this.robots[index].left_arm), this.materials.robot_texture.override({ambient: 0.1}));
      this.shapes.left_hand.draw(context, program_state, oot.times(this.robots[index].left_hand), this.materials.robot_texture.override({ambient: 0.1}));
      this.shapes.right_arm.draw(context, program_state, oot.times(this.robots[index].right_arm), this.materials.robot_texture.override({ambient: 0.1}));
      this.shapes.right_hand.draw(context, program_state, oot.times(this.robots[index].right_hand), this.materials.robot_texture.override({ambient: 0.1}));
    }
  }

  //Function to draw the trees and rocks
  draw_trees(context, program_state, model_transform) {
    let moot = model_transform
        .times(Mat4.rotation(g_z_rot, 0, 1, 0))
        .times(Mat4.translation(...g_origin_offset));
    for (var i = 0; i < 36; i += 1) {
      if (i % 2 == 0) {
        if (this.time_of_day == "day") {
          this.shapes.tree_trunk.draw(context, program_state, moot.times(Mat4.translation(this.random_x[i], 0.5, this.random_z[i])), this.materials.tree_trunk);
          this.shapes.tree_leaves.draw(context, program_state, moot.times(Mat4.translation(this.random_x[i], 1.4, this.random_z[i])), this.materials.tree_leaves);
        } else {
          this.shapes.tree_trunk.draw(context, program_state, moot.times(Mat4.translation(this.random_x[i], 0.5, this.random_z[i])), this.materials.tree_trunk.override({ambient: 0.3}));
          this.shapes.tree_leaves.draw(context, program_state, moot.times(Mat4.translation(this.random_x[i], 1.4, this.random_z[i])), this.materials.tree_leaves.override({ambient: 0.3}));
        }
      } else {
        if (this.time_of_day == "day")
          this.shapes.rock.draw(context, program_state, moot.times(Mat4.translation(this.random_x[i], -1, this.random_z[i])), this.materials.rock);
        else
          this.shapes.rock.draw(context, program_state, moot.times(Mat4.translation(this.random_x[i], -1, this.random_z[i])), this.materials.rock.override({ambient: 0.5}));
      }
    }
  }

  //Function to draw the pond
  draw_pond(context, program_state, model_transform) {
    //Draw water
    let oot = Mat4.identity()
        .times(Mat4.rotation(g_z_rot, 0, 1, 0))
        .times(Mat4.translation(...g_origin_offset));
    this.r = oot.times(Mat4.rotation(Math.PI / 2, 1, 0, 0)).times(Mat4.translation(0, 0, 1.6));
    const random = (x) => .5 * Math.sin(100 * x + program_state.animation_time / 200);
    this.shapes.pond.arrays.position.forEach((p, i, a) =>
        a[i] = vec3(p[0], p[1], .15 * random(i / a.length)));
    this.shapes.pond.flat_shade();
    if (this.time_of_day == "day")
      this.shapes.pond.draw(context, program_state, this.r, this.materials.water);
    else
      this.shapes.pond.draw(context, program_state, this.r, this.materials.water.override({ambient: 0.3}));
    this.shapes.pond.copy_onto_graphics_card(context.context, ["position", "normal"], false);

    //Draw walls
    let moot = model_transform
        .times(Mat4.rotation(g_z_rot, 0, 1, 0))
        .times(Mat4.translation(...g_origin_offset));
    if (this.time_of_day == "day") {
      this.shapes.wall.draw(context, program_state, moot.times(Mat4.scale(4, 0.45, 0.2)).times(Mat4.translation(-1.5, -4.0, -9.8)), this.materials.rock);
      this.shapes.wall.draw(context, program_state, moot.times(Mat4.rotation(Math.PI / 2, 0, 1.3, 0)).times(Mat4.scale(4, 0.45, 0.2)).times(Mat4.translation(1.44, -4.0, -9)), this.materials.rock);
      this.shapes.wall.draw(context, program_state, moot.times(Mat4.scale(4.2, 0.45, 0.2)).times(Mat4.translation(-1.4, -4.0, -49.8)), this.materials.rock);
      this.shapes.wall.draw(context, program_state, moot.times(Mat4.rotation(Math.PI / 2, 0, 1.3, 0)).times(Mat4.scale(4, 0.45, 0.2)).times(Mat4.translation(1.44, -4.0, -49.5)), this.materials.rock);
    } else {
      this.shapes.wall.draw(context, program_state, moot.times(Mat4.scale(4, 0.45, 0.2)).times(Mat4.translation(-1.5, -4.0, -9.8)), this.materials.rock.override({ambient: 0.5}));
      this.shapes.wall.draw(context, program_state, moot.times(Mat4.rotation(Math.PI / 2, 0, 1.3, 0)).times(Mat4.scale(4, 0.45, 0.2)).times(Mat4.translation(1.44, -4.0, -9)), this.materials.rock.override({ambient: 0.5}));
      this.shapes.wall.draw(context, program_state, moot.times(Mat4.scale(4.2, 0.45, 0.2)).times(Mat4.translation(-1.4, -4.0, -49.8)), this.materials.rock.override({ambient: 0.5}));
      this.shapes.wall.draw(context, program_state, moot.times(Mat4.rotation(Math.PI / 2, 0, 1.3, 0)).times(Mat4.scale(4, 0.45, 0.2)).times(Mat4.translation(1.44, -4.0, -49.5)), this.materials.rock.override({ambient: 0.5}));
    }
  }

  draw_boundary(context, program_state, model_transform){

    let moot = model_transform
        .times(Mat4.rotation(g_z_rot, 0, 1, 0))
        .times(Mat4.translation(...g_origin_offset));

    var R = 48;
    for(var theta = 0; theta < 2*Math.PI; theta+= 0.05){
      if(theta >= 0 && theta < Math.PI/2) {
        if(this.time_of_day == "day")
          this.shapes.fence.draw(context, program_state, moot.times(Mat4.translation(0, -1, 0)).times(Mat4.translation(R * Math.cos(theta), 0, R * Math.sin(theta))).times(Mat4.rotation(Math.PI / 2 - theta, 0, 1, 0)).times(Mat4.scale(0.77, 0.77, 0.77)), this.materials.tree_trunk);
        else
          this.shapes.fence.draw(context, program_state, moot.times(Mat4.translation(0, -1, 0)).times(Mat4.translation(R * Math.cos(theta), 0, R * Math.sin(theta))).times(Mat4.rotation(Math.PI / 2 - theta, 0, 1, 0)).times(Mat4.scale(0.77, 0.77, 0.77)), this.materials.tree_trunk.override({ambient: 0.1}));
      }else if(theta >= Math.PI/2 && theta < Math.PI) {
        if(this.time_of_day == "day")
          this.shapes.fence.draw(context, program_state, moot.times(Mat4.translation(0, -1, 0)).times(Mat4.translation(R * Math.cos(theta), 0, R * Math.sin(theta))).times(Mat4.rotation(Math.PI / 2 + Math.PI - theta, 0, 1, 0)).times(Mat4.scale(0.77, 0.77, 0.77)), this.materials.tree_trunk);
        else
          this.shapes.fence.draw(context, program_state, moot.times(Mat4.translation(0, -1, 0)).times(Mat4.translation(R * Math.cos(theta), 0, R * Math.sin(theta))).times(Mat4.rotation(Math.PI / 2 + Math.PI - theta, 0, 1, 0)).times(Mat4.scale(0.77, 0.77, 0.77)), this.materials.tree_trunk.override({ambient: 0.1}));
      }else if(theta >= Math.PI && theta < 3*Math.PI/2) {
        if(this.time_of_day == "day")
          this.shapes.fence.draw(context, program_state, moot.times(Mat4.translation(0, -1, 0)).times(Mat4.translation(R * Math.cos(theta), 0, R * Math.sin(theta))).times(Mat4.rotation(3 * Math.PI / 2 + Math.PI - theta, 0, 1, 0)).times(Mat4.scale(0.77, 0.77, 0.77)), this.materials.tree_trunk);
        else
          this.shapes.fence.draw(context, program_state, moot.times(Mat4.translation(0, -1, 0)).times(Mat4.translation(R * Math.cos(theta), 0, R * Math.sin(theta))).times(Mat4.rotation(3 * Math.PI / 2 + Math.PI - theta, 0, 1, 0)).times(Mat4.scale(0.77, 0.77, 0.77)), this.materials.tree_trunk.override({ambient: 0.1}));
      }
      else {
        if(this.time_of_day == "day")
          this.shapes.fence.draw(context, program_state, moot.times(Mat4.translation(0, -1, 0)).times(Mat4.translation(R * Math.cos(theta), 0, R * Math.sin(theta))).times(Mat4.rotation(2 * Math.PI + 3 * Math.PI / 2 - theta, 0, 1, 0)).times(Mat4.scale(0.77, 0.77, 0.77)), this.materials.tree_trunk);
        else
          this.shapes.fence.draw(context, program_state, moot.times(Mat4.translation(0, -1, 0)).times(Mat4.translation(R * Math.cos(theta), 0, R * Math.sin(theta))).times(Mat4.rotation(2 * Math.PI + 3 * Math.PI / 2 - theta, 0, 1, 0)).times(Mat4.scale(0.77, 0.77, 0.77)), this.materials.tree_trunk.override({ambient: 0.1}));

      }
    }
  }

  // The new version of the function will also translate according to the world offset, which
  // is a (x, y, z) tuple which will help us to make it look like the player is moving, but
  // in actuality, the world is the one moving. This is done to make computations easier.
  draw_environment(context, program_state, model_transform)
    {
      let ground_transform = model_transform
          .times(Mat4.rotation(g_z_rot, 0, 1, 0))
          .times(Mat4.translation(...g_origin_offset))
          .times(Mat4.rotation(Math.PI / 2, 1, 0, 0))
          .times(Mat4.translation(0, 0, 2))
          .times(Mat4.scale(50, 50, 0.5));

      let skybox_transform = model_transform
          .times(Mat4.rotation(g_z_rot, 0, 1, 0))
          .times(Mat4.translation(...g_origin_offset))
          .times(Mat4.rotation(Math.PI / 2, 1, 0, 0))
          .times(Mat4.scale(60, 60, 60))
          .times(Mat4.rotation(this.t/50, 0, 1, 0));
      if (this.time_of_day == "day")
        this.shapes.ground.draw(context, program_state, ground_transform, this.materials.ground);
      else
        this.shapes.ground.draw(context, program_state, ground_transform, this.materials.ground.override({ambient: 0.5}));
      if (this.time_of_day == "day") {
        this.shapes.skybox.draw(context, program_state, skybox_transform, this.materials.sky);
      } else {
        this.shapes.skybox.draw(context, program_state, skybox_transform, this.materials.night_sky);
      }
      this.draw_trees(context, program_state, model_transform);
      this.draw_pond(context, program_state, model_transform);
      this.draw_boundary(context, program_state, model_transform);
    }

}

export class Project extends Project_Base
{
  display( context, program_state )
    {
      // Setup
      super.display( context, program_state );
      let model_transform = Mat4.identity();
      const t = this.t = program_state.animation_time/1000;

      // Check if player is dead
      if (closest_robot_dist < 4){
        this.shapes.box.draw(context, program_state, Mat4.identity().times(Mat4.scale(2, 2, 2)).times(Mat4.translation(0, 0, -1)), this.materials.game_over);
        if (!this.died) {
          this.die_sound.play();
          this.died = true;
        }
      }
      // If player is alive
      else if (kills < max_robots && kills <= 10) {
        // Draw robot
        for (var i = 0; i < this.robots.length; i++)
          this.draw_robot(context, program_state, i);

        // Draw environment
        this.draw_environment(context, program_state, model_transform);

        this.pistol_transform = Mat4.identity()
            //.times(Mat4.rotation(g_z_rot, 0, 1, 0))
            .times(Mat4.translation(1.5, -0.9, -3))
            .times(Mat4.rotation(-4 * Math.PI / 8, 0, 1, 0))
            //.times(Mat4.rotation(Math.PI / 2, 1, 0, 0))
            .times(Mat4.scale(.4, .4, .4));

        if(this.fired_bullet){
          if(this.bullet_transform[0][3] < 0.1){
            this.bullet_transform = this.pistol_transform;
            this.fired_bullet = false
          }else{
            this.bullet_transform = this.bullet_transform.times(Mat4.translation(-10, 0.03, 0.1 * program_state.camera_transform[2][2]));
            this.shapes.box.draw(context, program_state, this.bullet_transform.times(Mat4.scale(3, 0.1, 0.1)), this.materials.plastic.override({color: color(1, 0, 0, 1), specularity: 1, ambient: 1}));
          }
        }

        let crosshair_top_transform = Mat4.identity().times(Mat4.translation(0, 0.05, -1.5)).times(Mat4.scale(0.005, 0.02, 0.01))
        let crosshair_bottom_transform = Mat4.identity().times(Mat4.translation(0, -0.05, -1.5)).times(Mat4.scale(0.005, 0.02, 0.01))
        let crosshair_left_transform = Mat4.identity().times(Mat4.translation(-0.05, 0, -1.5)).times(Mat4.scale(0.02, 0.005, 0.01))
        let crosshair_right_transform = Mat4.identity().times(Mat4.translation(0.05, 0, -1.5)).times(Mat4.scale(0.02, 0.005, 0.01))

        this.shapes.box.draw(context, program_state, crosshair_top_transform, this.materials.plastic.override({color: [1, 0, 0, 1]}));
        this.shapes.box.draw(context, program_state, crosshair_bottom_transform, this.materials.plastic.override({color: [1, 0, 0, 1]}));
        this.shapes.box.draw(context, program_state, crosshair_left_transform, this.materials.plastic.override({color: [1, 0, 0, 1]}));
        this.shapes.box.draw(context, program_state, crosshair_right_transform, this.materials.plastic.override({color: [1, 0, 0, 1]}));

        this.shapes.box.draw(context, program_state, Mat4.identity().times(Mat4.scale(0.5, 0.5, 0.5)).times(Mat4.translation(0.5, 0, -1)), this.materials.raygun);

        if (kills == 0)
          this.shapes.box.draw(context, program_state, Mat4.identity().times(Mat4.scale(1, 1, 1)).times(Mat4.translation(0.1, 0, -0.5)), this.materials.score0);
        else if (kills == 1)
          this.shapes.box.draw(context, program_state, Mat4.identity().times(Mat4.scale(1, 1, 1)).times(Mat4.translation(0.1, 0, -0.5)), this.materials.score1);
        else if (kills == 2)
          this.shapes.box.draw(context, program_state, Mat4.identity().times(Mat4.scale(1, 1, 1)).times(Mat4.translation(0.1, 0, -0.5)), this.materials.score2);
        else if (kills == 3)
          this.shapes.box.draw(context, program_state, Mat4.identity().times(Mat4.scale(1, 1, 1)).times(Mat4.translation(0.1, 0, -0.5)), this.materials.score3);
        else if (kills == 4)
          this.shapes.box.draw(context, program_state, Mat4.identity().times(Mat4.scale(1, 1, 1)).times(Mat4.translation(0.1, 0, -0.5)), this.materials.score4);
        else if (kills == 5)
          this.shapes.box.draw(context, program_state, Mat4.identity().times(Mat4.scale(1, 1, 1)).times(Mat4.translation(0.1, 0, -0.5)), this.materials.score5);
        else if(kills == 6)
          this.shapes.box.draw(context, program_state, Mat4.identity().times(Mat4.scale(1, 1, 1)).times(Mat4.translation(0.1, 0, -0.5)), this.materials.score6);
        else if(kills == 7)
           this.shapes.box.draw(context, program_state, Mat4.identity().times(Mat4.scale(1, 1, 1)).times(Mat4.translation(0.1, 0, -0.5)), this.materials.score7);
        else if(kills == 8)
           this.shapes.box.draw(context, program_state, Mat4.identity().times(Mat4.scale(1, 1, 1)).times(Mat4.translation(0.1, 0, -0.5)), this.materials.score8);
        else if(kills == 9)
           this.shapes.box.draw(context, program_state, Mat4.identity().times(Mat4.scale(1, 1, 1)).times(Mat4.translation(0.1, 0, -0.5)), this.materials.score9);
        else if(kills == 10)
           this.shapes.box.draw(context, program_state, Mat4.identity().times(Mat4.scale(1, 1, 1)).times(Mat4.translation(0.1, 0, -0.5)), this.materials.score10);
      }
      // If player wins
      else {
        this.shapes.box.draw(context, program_state, Mat4.identity().times(Mat4.scale(2, 2, 2)).times(Mat4.translation(0, 0, -1)), this.materials.winner);
        if (!this.won) {
          this.woohoo_sound.play();
          this.won = true;
        }
      }

    }
}