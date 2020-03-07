import {tiny, defs} from './common.js';

                                                  // Pull these names into this module's scope for convenience:
const { Triangle, Square, Tetrahedron, Windmill, Cube, Subdivision_Sphere, Capped_Cylinder } = defs;
// Pull these names into this module's scope for convenience:
const { vec3, vec4, vec, color, Mat4, Light, Shape, Material, Shader, Texture, Scene } = tiny;

let g_dx = 0, g_dy = 0;
let g_origin_offset = vec3(0, 0, 0);
let g_world_objects = [];
let g_cam_looking_at = vec3(NaN, NaN, NaN);
let g_x_ccs = vec3(NaN, NaN, NaN);
let g_z_ccs = vec3(NaN, NaN, NaN);
let g_z_rot = Math.PI;

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

    document.exitPointerLock = document.exitPointerLock;

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

  // This function is called when the user executes the movement keys, e.g. WASD.
  first_person_flyaround(radians_per_frame, meters_per_frame, leeway = 70 )
  {
    // We do not want the user to move up/down i.e. along the y axis. So we do not
    // accommodate for this.thrust[1] which is the axis.
    // The thrust values are subtracted from the g_origin_offset because we want the
    // objects to do the opposite of what I'm doing so it looks as if the cam is moving.
    if (this.thrust[0] !== 0) {
      g_origin_offset[0] -= this.thrust[0] * .1;
    } else if (this.thrust[2] !== 0) {
      g_origin_offset[2] -= this.thrust[2] * .1;
    }
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
      let y_ccs = this.matrix().times(vec4(0, 1, 0, 0)).to3();
      let rot_angle = radians_per_frame * dragging_vector.norm() * (dragging_vector[0] > 0 ? 1 : -1);
      // console.log(`Y Axis in CCS: (${y_ccs[0].toFixed(2)}, ${y_ccs[1].toFixed(2)}, ${y_ccs[2].toFixed(2)})`);
      horiz_rot = Mat4.rotation(rot_angle, y_ccs[0], y_ccs[1], y_ccs[2]);
    }

    // Report the x and z axis w.r.t. camera coordinate system.
    g_x_ccs = this.inverse().times(vec4(1, 0, 0, 0)).to3();
    g_z_ccs = this.inverse().times(vec4(0, 0, 1, 0)).to3();

    if (horiz_rot) {
      this.matrix().post_multiply(horiz_rot);
      this.inverse().pre_multiply(horiz_rot);
    }

    console.log(`CamZ: (${this.matrix()[0][2].toFixed(2)},
    ${this.matrix()[1][2].toFixed(2)},
    ${this.matrix()[2][2].toFixed(2)})`);

    // Change sign of z component because we are looking down the negative z axis.
    let cam = this.inverse();
    g_cam_looking_at = vec3(cam[0][2], cam[1][2], cam[2][2] * -1);

    // Compute angle of rotation between z axis and what I'm looking at.
    // g_z_rot = Math.acos(vec3(0, 0, 1).dot((vec3(...g_z_ccs))));
    // https://math.stackexchange.com/questions/654315/how-to-convert-a-dot-product-of-two-vectors-to-the-angle-between-the-vectors
    let z_angle= Math.atan2(g_z_ccs[2], g_z_ccs[0]) - Math.atan2(1, 0);
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

export class Project_Base extends Scene
{                                          // **Transforms_Sandbox_Base** is a Scene that can be added to any display canvas.
                                           // This particular scene is broken up into two pieces for easier understanding.
                                           // The piece here is the base class, which sets up the machinery to draw a simple
                                           // scene demonstrating a few concepts.  A subclass of it, Transforms_Sandbox,
                                           // exposes only the display() method, which actually places and draws the shapes,
                                           // isolating that code so it can be experimented with on its own.
  constructor()
    {                  // constructor(): Scenes begin by populating initial values like the Shapes and Materials they'll need.
      super();
      this.hover = this.swarm = false;
      this.shapes = { 'box'  : new Cube(),
                      'ball' : new Subdivision_Sphere( 4 ),
                      "head": new Shape_From_File( "assets/Head.obj"),
                      "top_torso": new Shape_From_File( "assets/Top-Torso.obj"),
                      "bottom_torso": new Shape_From_File( "assets/Bottom-Torso.obj"),
                      "left_arm": new Shape_From_File( "assets/Left-Arm.obj"),
                      "left_hand": new Shape_From_File( "assets/Left-Hand.obj"),
                      "right_arm": new Shape_From_File( "assets/Right-Arm.obj"),
                      "right_hand": new Shape_From_File( "assets/Right-Hand.obj"),
                      "ground" : new Capped_Cylinder(100, 100, [[0,2],[0,1]]),
                      "skybox": new Subdivision_Sphere(4),
                      "tree_trunk": new Shape_From_File("assets/tree_trunk.obj"),
                      "tree_leaves": new Shape_From_File("assets/tree_leaves.obj"),
                      "rock" : new Shape_From_File("assets/rock.obj"),
                      "pistol" : new Shape_From_File("assets/pistol.obj")
      };

      this.shapes.ground.arrays.texture_coord.forEach( p => p.scale_by(50));
      const phong = new defs.Phong_Shader();
      const textured = new defs.Textured_Phong( 1 );
      this.materials = { plastic: new Material( phong,
                                    { ambient: .2, diffusivity: 1, specularity: .5, color: color( .9,.5,.9,1 ) } ),
                        metal: new Material( phong,
                                    { ambient: .2, diffusivity: 1, specularity:  1, color: color( .9,.5,.9,1 ) } ),
                        robot_texture: new Material( textured,  { color: color( .5,.5,.5,1 ),
                                ambient: .3, diffusivity: .5, specularity: .5, texture: new Texture( "assets/R1_Color.jpg" )}),
                        ground: new Material( textured, { ambient: 1, specularity: 0.2, texture: new Texture( "assets/grass2.jpg")}),
                        sky: new Material( textured, { ambient: 1, specularity: 0.2, texture: new Texture( "assets/sky.jpg" ), color: color( 0,0,0,1 )}),
                        tree_leaves: new Material(phong, { ambient: .2, diffusivity: 1, specularity: .5, color: color( 0, 0.9, .1,1 ) } ),
                        tree_trunk: new Material(phong, {ambient: .2, diffusivity: 1, specularity: .5, color: color(0.9, 0.4, 0.1, 1)}),
                        rock: new Material(phong, {ambient: .2, diffusivity: 1, specularity: 0.5, color: color(0.9, 0.9, 0.9, 1)})};

      this.random_x = [];
      this.random_z = [];
      for(var i = 0; i < 15; i+= 1){
        var R = 48 * Math.random();
        var theta = Math.random() * 2 * Math.PI;
        this.random_x.push(R*Math.cos(theta));
        this.random_z.push(R*Math.sin(theta));
      }
    }
  make_control_panel()
    {                                 // make_control_panel(): Sets up a panel of interactive HTML elements, including
                                      // buttons with key bindings for affecting this scene, and live info readouts.
      this.control_panel.innerHTML += "Dragonfly rotation angle: <br>";
                                                // The next line adds a live text readout of a data member of our Scene.
      this.live_string( box => { box.textContent = ( this.hover ? 0 : ( this.t % (2*Math.PI)).toFixed(2) ) + " radians" } );
      this.new_line();
                                                // Add buttons so the user can actively toggle data members of our Scene:
      this.key_triggered_button( "Hover dragonfly in place", [ "h" ], function() { this.hover ^= 1; } );
      this.new_line();
      this.key_triggered_button( "Swarm mode", [ "m" ], function() { this.swarm ^= 1; } );

      this.new_line();
      this.live_string(box => { box.textContent =
          `Cam Looking At: (${g_cam_looking_at[0].toFixed(2)},
          ${g_cam_looking_at[1].toFixed(2)}, ${g_cam_looking_at[2].toFixed(2)})`; });
      this.new_line();
      this.live_string( box => { box.textContent = `World Offset: (${g_origin_offset[0].toFixed(2)}, ${g_origin_offset[1].toFixed(2)}, ${g_origin_offset[2].toFixed(2)})`; });
      this.new_line();
      if (g_x_ccs.every(x => x !== NaN)) {
        this.live_string( box => { box.textContent = `X CCS: (${g_x_ccs[0].toFixed(2)}, ${g_x_ccs[1].toFixed(2)}, ${g_x_ccs[2].toFixed(2)})`; });
      }
      this.new_line();
      if (g_z_ccs.every(x => x !== NaN)) {
        this.live_string( box => { box.textContent = `Z CCS: (${g_z_ccs[0].toFixed(2)}, ${g_z_ccs[1].toFixed(2)}, ${g_z_ccs[2].toFixed(2)})`; });
      }
      this.new_line();
      this.live_string ( box => { box.textContent = `Z Angle: ${g_z_rot.toFixed(4)}`; });
    }

  display( context, program_state )
    {
      // "Constructor" statements would go within this if
      // We do it here instead of the constructor above so that we have access to context and program state
      if( !context.scratchpad.controls )
        {
          // this.children.push( context.scratchpad.controls = new defs.Movement_Controls() );
          this.children.push(context.scratchpad.controls = new FPS_Controls());
          // program_state.set_camera( Mat4.translation( 0,0,0 ) );
          program_state.set_camera(Mat4.look_at(vec3(0, 0, 0), vec3(0, 0, 1), vec3(0, 1, 0)));

          // Get player location
          this.player_x = context.program_state.camera_inverse[0];
          this.player_y = context.program_state.camera_inverse[1];
          this.player_z = context.program_state.camera_inverse[2];
          this.d = context.program_state.camera_inverse[3];

          // Spawn all robots
          this.robot_location = [0, 0, 0];
          this.robot_location[0] = Mat4.identity().times(Mat4.translation(0,0,-25)).times(Mat4.scale(0.5, 0.5, 0.5));
          this.robot_location[1] = Mat4.identity().times(Mat4.translation(10,0,-45)).times(Mat4.scale(0.5, 0.5, 0.5));
          this.robot_location[2] = Mat4.identity().times(Mat4.translation(-10,0,-45)).times(Mat4.scale(0.5, 0.5, 0.5));
        }

      // Default Required Variables
      program_state.projection_transform = Mat4.perspective( Math.PI/4, context.width/context.height, 1, 150 );
      const t = this.t = program_state.animation_time/1000;
      const angle = Math.sin( t );
      //const light_position = Mat4.rotation( angle,   1,0,0 ).times( vec4( 0,-1,1,0 ) );
      program_state.lights = [ new Light( vec4( 0,-1,1,0 ), color( 1,1,1,1 ), 1000000 ) ];
    }

  draw_robot(context, program_state, index, robot_center)
  {

    // Calculate robot's planned path
    let x_location_diff = ((-1 * this.player_x[3]) - this.robot_location[index][0][3])/100;
    let y_location_diff = ((-1 * this.player_y[3]) - this.robot_location[index][1][3])/100;
    let z_location_diff = ((-1 * this.player_z[3]) - this.robot_location[index][2][3])/100;
    let euclidean_dist = 10 * Math.sqrt(Math.pow(x_location_diff, 2) + Math.pow(z_location_diff, 2));
    let x_rotation_angle  = 0.005 * Math.atan(x_location_diff/z_location_diff);

    // Set robot's planned path
    this.robot_location[index] = this.robot_location[index]
        .times(Mat4.rotation(x_rotation_angle, 0, 1, 0))
        .times(Mat4.translation(x_location_diff/euclidean_dist, 0, z_location_diff/euclidean_dist));

    // Draw Robot at robot_center
    const top_torso_transform = robot_center;
    const head_transform = top_torso_transform.times(Mat4.translation(0, 2.9, 0));
    const bottom_torso_transform = top_torso_transform.times(Mat4.rotation(Math.PI, 0, 1, 0))
        .times(Mat4.translation(0, -2.0, 0));
    const left_arm_transform = top_torso_transform.times(Mat4.translation(2, 0, 0));
    const left_hand_transform = top_torso_transform.times(Mat4.translation(2.9, -2.7, 0))
        .times(Mat4.scale(0.5, 0.5, 0.5));
    const right_arm_transform = top_torso_transform.times(Mat4.translation(-2, 0, 0));
    const right_hand_transform = top_torso_transform.times(Mat4.translation(-2.9, -2.7, 0))
        .times(Mat4.scale(0.5, 0.5, 0.5));
    this.shapes.head.draw( context, program_state, head_transform, this.materials.robot_texture);
    this.shapes.top_torso.draw( context, program_state, top_torso_transform, this.materials.robot_texture);
    this.shapes.bottom_torso.draw( context, program_state, bottom_torso_transform, this.materials.robot_texture);
    this.shapes.left_arm.draw( context, program_state, left_arm_transform, this.materials.robot_texture);
    this.shapes.left_hand.draw( context, program_state, left_hand_transform, this.materials.robot_texture);
    this.shapes.right_arm.draw( context, program_state, right_arm_transform, this.materials.robot_texture);
    this.shapes.right_hand.draw( context, program_state, right_hand_transform, this.materials.robot_texture);
  }
  /*
  draw_tree(context, program_state, model_transform){
    for(var theta = 0; theta < 2*Math.PI; theta+=0.1){
      this.shapes.tree_trunk.draw(context, program_state, model_transform.times(Mat4.translation(48*Math.cos(theta), 0.5, 48*Math.sin(theta))), this.materials.plastic);
      this.shapes.tree_leaves.draw(context, program_state, model_transform.times(Mat4.translation(48*Math.cos(theta), 1.4, 48*Math.sin(theta))), this.materials.tree_leaves);
    }
  }
 */

  //Function to draw trees randomly in the environment
  draw_trees(context, program_state, model_transform){
    for(var i = 0; i < 15; i+= 1){
      this.shapes.tree_trunk.draw(context, program_state, model_transform.times(Mat4.translation(this.random_x[i], 0.5, this.random_z[i])), this.materials.tree_trunk);
      this.shapes.tree_leaves.draw(context, program_state, model_transform.times(Mat4.translation(this.random_x[i], 1.4, this.random_z[i])), this.materials.tree_leaves);
    }
  }

  //Function to draw the environment
  draw_environment(context, program_state, model_transform){
    this.shapes.ground.draw(context, program_state, model_transform.times(Mat4.rotation(Math.PI/2, 1, 0, 0)).times(Mat4.translation(0, 0, 2)).times(Mat4.scale(50, 50, 0.5)), this.materials.ground);
    this.shapes.skybox.draw(context, program_state, model_transform.times(Mat4.rotation(Math.PI/2, 1, 0, 0)).times(Mat4.scale(60, 60, 60)), this.materials.sky);
    //this.draw_tree(context, program_state, model_transform);
    this.draw_trees(context, program_state, model_transform);
    this.shapes.rock.draw(context, program_state, model_transform.times(Mat4.translation(0, -1, 0)), this.materials.rock);
    this.shapes.rock.draw(context, program_state, model_transform.times(Mat4.translation(10, -1, 15)), this.materials.rock);
    this.shapes.rock.draw(context, program_state, model_transform.times(Mat4.translation(17, -1, 33)), this.materials.rock);
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

      // DEBUGGING
      // if ( this.player_x[0] !== context.program_state.camera_inverse[0][0] ||
      //       this.player_x[1] !== context.program_state.camera_inverse[0][1] ||
      //     this.player_x[2] !== context.program_state.camera_inverse[0][2] ||
      //     this.player_x[3] !== context.program_state.camera_inverse[0][3] ||
      //     this.player_y[0] !== context.program_state.camera_inverse[1][0] ||
      //     this.player_y[1] !== context.program_state.camera_inverse[1][1] ||
      //     this.player_y[2] !== context.program_state.camera_inverse[1][2] ||
      //     this.player_y[3] !== context.program_state.camera_inverse[1][3] ||
      //     this.player_z[0] !== context.program_state.camera_inverse[2][0] ||
      //     this.player_z[1] !== context.program_state.camera_inverse[2][1] ||
      //     this.player_z[2] !== context.program_state.camera_inverse[2][2] ||
      //     this.player_z[3] !== context.program_state.camera_inverse[2][3])
      // {
      //   console.log("Player: ", context.program_state.camera_inverse);
      //   console.log("Robot: ", this.robot_location);
      // }

      // Get Player's x, y, and z coordinates
      this.player_x = context.program_state.camera_inverse[0];
      this.player_y = context.program_state.camera_inverse[1];
      this.player_z = context.program_state.camera_inverse[2];

      // Ensure player cannot move in y-space
      // context.program_state.camera_inverse = Mat4.translation(this.player_x[3], 0, this.player_z[3]);

      // Draw robot
      this.draw_robot(context, program_state, 0, this.robot_location[0]);
      this.draw_robot(context, program_state, 1, this.robot_location[1]);
      this.draw_robot(context, program_state, 2, this.robot_location[2]);
      // Draw environment
      this.draw_environment(context, program_state, model_transform);

      // let cube_transform = Mat4.identity().times(Mat4.rotation(g_z_rot, 0, 1, 0)).times(Mat4.translation(0, 0, -5));
      let pistol_transform = Mat4.identity()
          .times(Mat4.rotation(g_z_rot, 0, 1, 0))
          .times(Mat4.translation(1.75, -.8, -3))
          .times(Mat4.rotation(2 * Math.PI / 3, 0, 1, 0))
          .times(Mat4.rotation(Math.PI / 2, 1, 0, 0))
          .times(Mat4.scale(.4, .4, .4));
      this.shapes.pistol.draw(context, program_state, pistol_transform,
          this.materials.metal.override( { color: [128/255, 128/255, 128/255, 1] }));
      // this.shapes.box.draw(context, program_state, Mat4.identity().times(Mat4.translation(3, 0, 0)), this.materials.plastic);
    }
}